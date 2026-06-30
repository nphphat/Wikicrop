"""MobileSAM bbox-prompt refinement via ONNX Runtime.

The encoder runs once per image and the lightweight decoder runs once per
YOLO instance. This replaces per-crop FastSAM plus CPU GrabCut/edge-snap for
the default backend path.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

from .config import BACKEND_ROOT, int_param
from .yolo_segment import InstanceMask

IMAGE_SIZE = 1024
PIXEL_MEAN = np.array([123.675, 116.28, 103.53], dtype=np.float32)
PIXEL_STD = np.array([58.395, 57.12, 57.375], dtype=np.float32)


@lru_cache(maxsize=2)
def _session(model_path: str):
    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise RuntimeError(
            "Python dependency 'onnxruntime' is missing. "
            "Install backend/python/requirements.txt."
        ) from exc
    return ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])


def refine_instances_with_mobile_sam(
    rgb: np.ndarray,
    yolo_instances: list[InstanceMask],
    params: dict,
) -> list[InstanceMask]:
    if not yolo_instances:
        return []

    encoder_path = _resolve_model(
        str(params.get("samEncoderModel") or "previous_model/mobile_sam_encoder.onnx").strip()
    )
    decoder_path = _resolve_model(
        str(params.get("samModel") or "previous_model/mobile_sam_decoder.onnx").strip()
    )
    encoder = _session(encoder_path)
    decoder = _session(decoder_path)

    blob, resized_shape = _preprocess(rgb)
    embedding = encoder.run(None, {encoder.get_inputs()[0].name: blob})[0]

    h_img, w_img = rgb.shape[:2]
    padding = int_param(params, "samBoxPadding")
    refined: list[InstanceMask] = []

    for instance in yolo_instances:
        bbox = _bbox_for_mask(instance.mask, h_img, w_img, padding)
        if bbox is None:
            refined.append(instance)
            continue

        box_1024 = _scale_box_to_encoder(bbox, (h_img, w_img), resized_shape)
        masks, scores = decoder.run(
            None,
            {
                decoder.get_inputs()[0].name: embedding,
                decoder.get_inputs()[1].name: box_1024[np.newaxis, :].astype(np.float32),
            },
        )
        mask = _select_refined_mask(
            masks[0],
            scores[0],
            resized_shape,
            (h_img, w_img),
            instance.mask,
        )
        if mask is None:
            refined.append(instance)
            continue

        refined.append(
            InstanceMask(
                mask=mask,
                confidence=instance.confidence,
                class_id=instance.class_id,
                class_name=instance.class_name,
                source="mobile_sam_onnx",
            )
        )

    return refined


def is_mobile_sam_model(model_name: str) -> bool:
    return "mobile_sam" in Path(model_name).name.lower()


def _preprocess(rgb: np.ndarray) -> tuple[np.ndarray, tuple[int, int]]:
    orig_h, orig_w = rgb.shape[:2]
    scale = IMAGE_SIZE / max(orig_h, orig_w)
    resized_h = int(orig_h * scale + 0.5)
    resized_w = int(orig_w * scale + 0.5)

    resized = cv2.resize(rgb, (resized_w, resized_h), interpolation=cv2.INTER_LINEAR)
    normalized = (resized.astype(np.float32) - PIXEL_MEAN) / PIXEL_STD
    padded = np.zeros((IMAGE_SIZE, IMAGE_SIZE, 3), dtype=np.float32)
    padded[:resized_h, :resized_w] = normalized
    blob = padded.transpose(2, 0, 1)[np.newaxis]
    return blob, (resized_h, resized_w)


def _select_refined_mask(
    low_res_masks: np.ndarray,
    iou_predictions: np.ndarray,
    resized_shape: tuple[int, int],
    original_shape: tuple[int, int],
    yolo_mask: np.ndarray,
) -> np.ndarray | None:
    if low_res_masks.ndim != 3 or low_res_masks.shape[0] == 0:
        return None

    yolo_area = int(np.count_nonzero(yolo_mask))
    best_mask: np.ndarray | None = None
    best_score = -1.0

    order = np.argsort(iou_predictions)[::-1]
    for index in order:
        mask = _postprocess_mask(low_res_masks[int(index)], resized_shape, original_shape)
        if mask is None:
            continue
        area = int(np.count_nonzero(mask))
        if area < max(4, int(yolo_area * 0.20)) or area > max(16, int(yolo_area * 2.50)):
            continue
        overlap = _mask_overlap(mask, yolo_mask)
        if overlap < 0.35:
            continue
        inter = int(np.count_nonzero(np.logical_and(mask, yolo_mask)))
        union = area + yolo_area - inter
        iou = inter / max(union, 1)
        score = iou + 0.25 * overlap
        if score > best_score:
            best_score = score
            best_mask = mask

    return best_mask


def _postprocess_mask(
    mask_logits: np.ndarray,
    resized_shape: tuple[int, int],
    original_shape: tuple[int, int],
) -> np.ndarray | None:
    mask_logits = mask_logits.astype(np.float32)
    mask_1024 = cv2.resize(mask_logits, (IMAGE_SIZE, IMAGE_SIZE), interpolation=cv2.INTER_LINEAR)

    resized_h, resized_w = resized_shape
    orig_h, orig_w = original_shape
    mask_resized = mask_1024[:resized_h, :resized_w]
    mask_original = cv2.resize(mask_resized, (orig_w, orig_h), interpolation=cv2.INTER_LINEAR)
    binary = mask_original > 0.0
    return binary if np.any(binary) else None


def _scale_box_to_encoder(
    bbox: tuple[int, int, int, int],
    original_shape: tuple[int, int],
    resized_shape: tuple[int, int],
) -> np.ndarray:
    orig_h, orig_w = original_shape
    resized_h, resized_w = resized_shape
    scale_x = resized_w / orig_w
    scale_y = resized_h / orig_h
    x1, y1, x2, y2 = bbox
    return np.array(
        [x1 * scale_x, y1 * scale_y, x2 * scale_x, y2 * scale_y],
        dtype=np.float32,
    )


def _bbox_for_mask(
    mask: np.ndarray,
    h_img: int,
    w_img: int,
    padding: int,
) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    x1 = max(0, int(xs.min()) - padding)
    y1 = max(0, int(ys.min()) - padding)
    x2 = min(w_img, int(xs.max()) + 1 + padding)
    y2 = min(h_img, int(ys.max()) + 1 + padding)
    if x2 <= x1 or y2 <= y1:
        return None
    return x1, y1, x2, y2


def _mask_overlap(a: np.ndarray, b: np.ndarray) -> float:
    inter = int(np.count_nonzero(np.logical_and(a, b)))
    if inter == 0:
        return 0.0
    smaller = min(int(np.count_nonzero(a)), int(np.count_nonzero(b)))
    return float(inter / max(smaller, 1))


def _resolve_model(model_name: str) -> str:
    candidate = Path(model_name)
    if candidate.is_absolute() and candidate.exists():
        return str(candidate)

    search = [
        BACKEND_ROOT / "model" / model_name,
        BACKEND_ROOT.parent / model_name,
        candidate,
    ]
    for path in search:
        if path.exists():
            return str(path)
    raise FileNotFoundError(
        f"MobileSAM ONNX model not found: {model_name}. "
        "Run `python scripts/export_mobile_sam_onnx.py` first."
    )
