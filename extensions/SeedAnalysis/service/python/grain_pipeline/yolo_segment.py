"""YOLO segmentation inference via ONNX Runtime (CPU-only).

Replaces the previous Ultralytics / PyTorch implementation so that the backend
no longer requires `torch` or `ultralytics` at runtime.  Inference is
performed directly on the exported `best.onnx` using `onnxruntime`.

YOLO-seg ONNX output layout (opset 12, YOLOv8n-seg):
  output0  – [1, 4+nc+32, N]   boxes (cx,cy,w,h), class scores, mask coefficients
  output1  – [1, 32, mh, mw]   prototype masks  (mh = mw = imgsz/4 = 160)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

from .config import bool_param, float_param, int_param, model_path

CLASS_NAMES = {
    0: "seed",
    1: "Ref",
}


# ---------------------------------------------------------------------------
# Data class
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class InstanceMask:
    mask: np.ndarray
    confidence: float
    class_id: int
    class_name: str
    source: str = "full"


# ---------------------------------------------------------------------------
# Session cache
# ---------------------------------------------------------------------------

@lru_cache(maxsize=4)
def _onnx_session(weights: str):
    """Load and cache an ONNX Runtime inference session."""
    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise RuntimeError(
            "Python dependency 'onnxruntime' is missing. "
            "Install backend/python/requirements.txt."
        ) from exc
    sess = ort.InferenceSession(weights, providers=["CPUExecutionProvider"])
    return sess


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def predict_instances(rgb: np.ndarray, params: dict) -> list[InstanceMask]:
    weights = model_path(params)
    session = _onnx_session(weights)

    if not bool_param(params, "enableTiledInference"):
        return _predict_single_image(session, rgb, params, source="full")

    instances: list[InstanceMask] = []
    if bool_param(params, "enableFullImagePass"):
        instances.extend(_predict_single_image(session, rgb, params, source="full"))

    height, width = rgb.shape[:2]
    for size, source in _tile_passes(params):
        for tile, x_off, y_off, touches_edge in _tiles(rgb, size, float_param(params, "tileOverlap")):
            tile_instances = _predict_single_image(session, tile, params, source=source)
            for item in tile_instances:
                full_mask = np.zeros((height, width), dtype=bool)
                th, tw = tile.shape[:2]
                conf = item.confidence
                if _touches_tile_margin(item.mask, touches_edge, float_param(params, "edgeMarginRatio")):
                    conf *= 0.92
                full_mask[y_off: y_off + th, x_off: x_off + tw] = item.mask
                instances.append(
                    InstanceMask(
                        mask=full_mask,
                        confidence=conf,
                        class_id=item.class_id,
                        class_name=item.class_name,
                        source=source,
                    )
                )

    return _merge_instances(
        instances,
        float_param(params, "mergeIou"),
        float_param(params, "mergeOverlap"),
    )


# ---------------------------------------------------------------------------
# Single-image inference + decode
# ---------------------------------------------------------------------------

def _predict_single_image(
    session,
    rgb: np.ndarray,
    params: dict,
    source: str,
) -> list[InstanceMask]:
    # Read the required input size from the model itself (static ONNX shape)
    input_meta = session.get_inputs()[0]
    _, _, model_h, model_w = input_meta.shape   # [1, 3, H, W]
    imgsz = int(model_h)  # YOLO models use square input

    conf_thr = float_param(params, "yoloConf")
    iou_thr  = float_param(params, "yoloIou")
    max_det  = int_param(params, "yoloMaxDet")

    padded, crop_h, crop_w = _pad_to_square(rgb)
    blob = _to_blob(padded, imgsz)           # [1, 3, imgsz, imgsz]

    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: blob})
    # output0: [1, 4+nc+32, N] with cxcywh boxes, or [1, N, 4+nc+32]
    # with xyxy boxes for newer end-to-end YOLO exports. output1: [1, 32, mh, mw]
    output0 = outputs[0][0]   # [4+nc+32, N] or [N, 4+nc+32]
    protos   = outputs[1][0]  # [32, mh, mw]
    boxes_are_xyxy = False
    if output0.ndim == 2 and output0.shape[0] > output0.shape[1]:
        output0 = output0.T
        boxes_are_xyxy = True

    return _decode_yolo_seg(
        output0, protos,
        padded_shape=padded.shape[:2],
        crop_shape=(crop_h, crop_w),
        imgsz=imgsz,
        conf_thr=conf_thr,
        iou_thr=iou_thr,
        max_det=max_det,
        source=source,
        boxes_are_xyxy=boxes_are_xyxy,
    )


def _to_blob(rgb: np.ndarray, imgsz: int) -> np.ndarray:
    """Resize → [0,1] normalise → NCHW float32 blob."""
    img = cv2.resize(rgb, (imgsz, imgsz), interpolation=cv2.INTER_LINEAR)
    img = img.astype(np.float32) / 255.0
    return img.transpose(2, 0, 1)[np.newaxis]   # [1, 3, H, W]


def _decode_yolo_seg(
    output0: np.ndarray,   # [4+nc+32, N]
    protos: np.ndarray,    # [32, mh, mw]
    *,
    padded_shape: tuple[int, int],
    crop_shape: tuple[int, int],
    imgsz: int,
    conf_thr: float,
    iou_thr: float,
    max_det: int,
    source: str,
    boxes_are_xyxy: bool = False,
) -> list[InstanceMask]:
    """Decode raw YOLO-seg ONNX tensors into InstanceMask objects."""
    # output0 layout: [cx, cy, w, h, cls0, ..., clsN, coeff0, ..., coeff31]
    num_coords = 4
    num_coeffs = 32
    num_classes = output0.shape[0] - num_coords - num_coeffs

    boxes_raw   = output0[:4, :]         # [4, N]  cx,cy,w,h in imgsz space
    class_logit = output0[4: 4 + num_classes, :]   # [nc, N]
    coeffs      = output0[-32:, :]       # [32, N]

    # Class confidence = max score across classes
    class_scores = class_logit.max(axis=0)          # [N]
    class_ids    = class_logit.argmax(axis=0)       # [N]

    keep = class_scores >= conf_thr
    if not np.any(keep):
        return []

    boxes_raw   = boxes_raw[:, keep]
    class_scores = class_scores[keep]
    class_ids    = class_ids[keep]
    coeffs       = coeffs[:, keep]

    # Convert cx,cy,w,h → x1,y1,x2,y2
    boxes_xyxy = boxes_raw.T if boxes_are_xyxy else _cxcywh_to_xyxy(boxes_raw.T)

    # NMS
    indices = _nms(boxes_xyxy, class_scores, class_ids, iou_thr, max_det)
    if len(indices) == 0:
        return []

    boxes_xyxy   = boxes_xyxy[indices]
    class_scores = class_scores[indices]
    class_ids    = class_ids[indices]
    coeffs       = coeffs[:, indices]   # [32, M]

    # Decode proto masks
    _, proto_h, proto_w = protos.shape
    proto_flat = protos.reshape(32, -1)                  # [32, mh*mw]
    mask_flat  = _sigmoid(coeffs.T @ proto_flat)         # [M, mh*mw]
    masks_proto = mask_flat.reshape(-1, proto_h, proto_w)  # [M, mh, mw]

    pad_h, pad_w = padded_shape
    crop_h, crop_w = crop_shape
    scale_x = pad_w / imgsz
    scale_y = pad_h / imgsz

    instances: list[InstanceMask] = []
    for i in range(len(indices)):
        # Crop mask to box region in proto space (avoids bleeding)
        x1_p = int(boxes_xyxy[i, 0] / imgsz * proto_w)
        y1_p = int(boxes_xyxy[i, 1] / imgsz * proto_h)
        x2_p = int(np.ceil(boxes_xyxy[i, 2] / imgsz * proto_w))
        y2_p = int(np.ceil(boxes_xyxy[i, 3] / imgsz * proto_h))
        x1_p, y1_p = max(0, x1_p), max(0, y1_p)
        x2_p, y2_p = min(proto_w, x2_p), min(proto_h, y2_p)

        # Upsample with high-quality interpolation
        mask_f = masks_proto[i]
        # Resize to padded size
        mask_up = cv2.resize(
            mask_f.astype(np.float32),
            (pad_w, pad_h),
            interpolation=cv2.INTER_LANCZOS4,
        )
        x1 = max(0, int(np.floor(boxes_xyxy[i, 0] * scale_x)))
        y1 = max(0, int(np.floor(boxes_xyxy[i, 1] * scale_y)))
        x2 = min(pad_w, int(np.ceil(boxes_xyxy[i, 2] * scale_x)))
        y2 = min(pad_h, int(np.ceil(boxes_xyxy[i, 3] * scale_y)))
        cropped_mask = np.zeros_like(mask_up, dtype=np.float32)
        if x2 > x1 and y2 > y1:
            cropped_mask[y1:y2, x1:x2] = mask_up[y1:y2, x1:x2]
        mask_up = cropped_mask
        # Crop to original content area (remove padding)
        mask_up = mask_up[:crop_h, :crop_w]
        binary  = (mask_up > 0.5).astype(bool)

        if not np.any(binary):
            continue

        instances.append(
            InstanceMask(
                mask=binary,
                confidence=float(class_scores[i]),
                class_id=int(class_ids[i]),
                class_name=class_name_for_id(int(class_ids[i])),
                source=source,
            )
        )

    return instances


def class_name_for_id(class_id: int) -> str:
    return CLASS_NAMES.get(int(class_id), str(int(class_id)))


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _cxcywh_to_xyxy(boxes: np.ndarray) -> np.ndarray:
    """Convert [cx,cy,w,h] → [x1,y1,x2,y2]."""
    out = np.empty_like(boxes)
    out[:, 0] = boxes[:, 0] - boxes[:, 2] / 2
    out[:, 1] = boxes[:, 1] - boxes[:, 3] / 2
    out[:, 2] = boxes[:, 0] + boxes[:, 2] / 2
    out[:, 3] = boxes[:, 1] + boxes[:, 3] / 2
    return out


def _sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -88, 88)))


def _nms(
    boxes: np.ndarray,
    scores: np.ndarray,
    class_ids: np.ndarray,
    iou_thr: float,
    max_det: int,
) -> list[int]:
    """Greedy NMS returning kept indices (sorted by descending score)."""
    order = scores.argsort()[::-1]
    x1, y1, x2, y2 = boxes[:, 0], boxes[:, 1], boxes[:, 2], boxes[:, 3]
    areas = (x2 - x1) * (y2 - y1)

    kept = []
    while len(order) > 0 and len(kept) < max_det:
        i = order[0]
        kept.append(int(i))
        if len(order) == 1:
            break
        rest = order[1:]
        ix1 = np.maximum(x1[i], x1[rest])
        iy1 = np.maximum(y1[i], y1[rest])
        ix2 = np.minimum(x2[i], x2[rest])
        iy2 = np.minimum(y2[i], y2[rest])
        inter = np.maximum(0, ix2 - ix1) * np.maximum(0, iy2 - iy1)
        iou   = inter / np.maximum(areas[i] + areas[rest] - inter, 1e-6)
        same_class = class_ids[rest] == class_ids[i]
        order = rest[np.logical_or(~same_class, iou < iou_thr)]

    return kept


# ---------------------------------------------------------------------------
# Tiling helpers (unchanged logic from original)
# ---------------------------------------------------------------------------

def _pad_to_square(rgb: np.ndarray) -> tuple[np.ndarray, int, int]:
    h, w = rgb.shape[:2]
    side = max(h, w)
    if h == side and w == side:
        return rgb, h, w
    padded = np.full((side, side, 3), 255, dtype=np.uint8)
    padded[:h, :w] = rgb
    return padded, h, w


def _tile_passes(params: dict) -> list[tuple[int, str]]:
    passes = [(int_param(params, "tileSize"), "tile")]
    if bool_param(params, "enableTinyTilePass"):
        tiny = int_param(params, "tinyTileSize")
        if tiny != passes[0][0]:
            passes.append((tiny, "tiny_tile"))
    return passes


def _tiles(rgb: np.ndarray, tile_size: int, overlap: float):
    h, w = rgb.shape[:2]
    tile_size = max(1, int(tile_size))
    step = max(1, int(round(tile_size * (1.0 - max(0.0, min(0.8, overlap))))))
    xs = _starts(w, tile_size, step)
    ys = _starts(h, tile_size, step)
    for y in ys:
        for x in xs:
            x2 = min(w, x + tile_size)
            y2 = min(h, y + tile_size)
            touches_edge = {
                "left":   x == 0,
                "top":    y == 0,
                "right":  x2 == w,
                "bottom": y2 == h,
            }
            yield rgb[y:y2, x:x2], x, y, touches_edge


def _starts(length: int, tile_size: int, step: int) -> list[int]:
    if length <= tile_size:
        return [0]
    starts = list(range(0, max(1, length - tile_size + 1), step))
    last = length - tile_size
    if starts[-1] != last:
        starts.append(last)
    return starts


def _touches_tile_margin(mask: np.ndarray, touches_edge: dict, margin_ratio: float) -> bool:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return False
    h, w = mask.shape[:2]
    margin = int(round(min(h, w) * max(0.0, margin_ratio)))
    if margin <= 0:
        return False
    if not touches_edge.get("left")   and int(xs.min()) <= margin:         return True
    if not touches_edge.get("right")  and int(xs.max()) >= w - margin:     return True
    if not touches_edge.get("top")    and int(ys.min()) <= margin:         return True
    if not touches_edge.get("bottom") and int(ys.max()) >= h - margin:     return True
    return False


def _merge_instances(
    instances: list[InstanceMask],
    merge_iou: float,
    merge_overlap: float,
) -> list[InstanceMask]:
    selected: list[InstanceMask] = []
    selected_meta: list[tuple[InstanceMask, tuple[int, int, int, int], int]] = []
    for item in sorted(instances, key=lambda x: x.confidence, reverse=True):
        item_bbox = _mask_bbox(item.mask)
        if item_bbox is None:
            continue
        item_area = int(np.count_nonzero(item.mask))
        # Merge purely by mask IoU — do NOT filter by class_id, because the same
        # physical grain detected in overlapping tiles may get different class indices
        # depending on local context, which would prevent correct deduplication.
        duplicate = any(
            _bbox_intersects(item_bbox, kept_bbox)
            and (
                _mask_iou_with_areas(item.mask, item_area, kept.mask, kept_area) >= merge_iou
                or _mask_overlap_with_areas(item.mask, item_area, kept.mask, kept_area) >= merge_overlap
            )
            for kept, kept_bbox, kept_area in selected_meta
        )
        if not duplicate:
            selected.append(item)
            selected_meta.append((item, item_bbox, item_area))
    return selected


def _mask_iou(a: np.ndarray, b: np.ndarray) -> float:
    return _mask_iou_with_areas(
        a,
        int(np.count_nonzero(a)),
        b,
        int(np.count_nonzero(b)),
    )


def _mask_iou_with_areas(a: np.ndarray, area_a: int, b: np.ndarray, area_b: int) -> float:
    inter = int(np.count_nonzero(np.logical_and(a, b)))
    if inter == 0:
        return 0.0
    union = area_a + area_b - inter
    return float(inter / max(union, 1))


def _mask_overlap(a: np.ndarray, b: np.ndarray) -> float:
    return _mask_overlap_with_areas(
        a,
        int(np.count_nonzero(a)),
        b,
        int(np.count_nonzero(b)),
    )


def _mask_overlap_with_areas(a: np.ndarray, area_a: int, b: np.ndarray, area_b: int) -> float:
    inter = int(np.count_nonzero(np.logical_and(a, b)))
    if inter == 0:
        return 0.0
    smaller = min(area_a, area_b)
    return float(inter / max(smaller, 1))


def _mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _bbox_intersects(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]
