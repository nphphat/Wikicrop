"""FastSAM-s segmentation refinement via ONNX Runtime (CPU-only).

Replaces the previous Ultralytics/PyTorch FastSAM implementation.
Uses `FastSAM-s.onnx` which must be exported once via `scripts/export_onnx.bat`.

Strategy: instead of running FastSAM on the full image and filtering by bbox
(which required Ultralytics' prompt feature), we run FastSAM on a per-instance
crop.  This is semantically equivalent, more efficient, and works identically
on every platform without CUDA.

FastSAM-s ONNX output layout (same as YOLOv8-seg, 1 class):
  output0  – [1, 4+1+32, N]   boxes + score + 32 mask coefficients
  output1  – [1, 32, mh, mw]  prototype masks
"""

from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

import cv2
import numpy as np

from .config import bool_param, float_param, int_param
from .yolo_segment import InstanceMask, _cxcywh_to_xyxy, _nms, _sigmoid


# ---------------------------------------------------------------------------
# Session cache
# ---------------------------------------------------------------------------

@lru_cache(maxsize=2)
def _fastsam_session(model_path: str):
    """Load and cache a FastSAM ONNX Runtime session."""
    try:
        import onnxruntime as ort
    except ImportError as exc:
        raise RuntimeError(
            "Python dependency 'onnxruntime' is missing. "
            "Install backend/python/requirements.txt."
        ) from exc
    return ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def refine_instances_with_fastsam(
    rgb: np.ndarray,
    yolo_instances: list[InstanceMask],
    params: dict,
) -> list[InstanceMask]:
    """Refine each YOLO instance mask by running FastSAM on its cropped region.

    For every YOLO instance:
    1. Crop the image to the instance bounding-box + padding.
    2. Run FastSAM-s ONNX on that crop.
    3. Pick the FastSAM mask that best overlaps the YOLO mask (highest IoU).
    4. If a good match is found, replace the YOLO mask with the refined one.
    5. Otherwise keep the original YOLO mask.
    """
    if not yolo_instances:
        return []

    model_name = _resolve_fastsam_model(str(params.get("samModel") or "FastSAM-s.onnx").strip() or "FastSAM-s.onnx")
    session = _fastsam_session(model_name)

    padding     = int_param(params, "samBoxPadding")
    conf_thr    = float_param(params, "samConf")
    iou_thr     = float_param(params, "samIou")
    max_det     = int_param(params, "samMaxDet")

    h_img, w_img = rgb.shape[:2]
    refined: list[InstanceMask] = []

    for instance in yolo_instances:
        bbox = _bbox_for_mask(instance.mask, h_img, w_img, padding)
        if bbox is None:
            refined.append(instance)
            continue

        x1, y1, x2, y2 = bbox
        crop_rgb = rgb[y1:y2, x1:x2]
        if crop_rgb.size == 0:
            refined.append(instance)
            continue

        crop_masks = _predict_crop(
            session, crop_rgb,
            conf_thr=conf_thr, iou_thr=iou_thr, max_det=max_det,
        )
        if not crop_masks:
            refined.append(instance)
            continue

        # Map crop masks back to full image and find best overlap with YOLO mask
        yolo_mask = instance.mask
        best_mask: np.ndarray | None = None
        best_iou = 0.0

        for crop_m in crop_masks:
            full_m = np.zeros((h_img, w_img), dtype=bool)
            ch, cw = crop_m.shape[:2]
            # paste, clipping to image bounds
            dy = min(ch, h_img - y1)
            dx = min(cw, w_img - x1)
            full_m[y1: y1 + dy, x1: x1 + dx] = crop_m[:dy, :dx]

            inter = int(np.count_nonzero(np.logical_and(full_m, yolo_mask)))
            if inter == 0:
                continue
            union = int(np.count_nonzero(np.logical_or(full_m, yolo_mask)))
            iou = inter / max(union, 1)
            if iou > best_iou:
                best_iou = iou
                best_mask = full_m

        if best_mask is not None and best_iou > 0.1:
            refined.append(
                InstanceMask(
                    mask=best_mask,
                    confidence=instance.confidence,
                    class_id=instance.class_id,
                    class_name=instance.class_name,
                    source="fastsam_onnx",
                )
            )
        else:
            refined.append(instance)

    return refined


# ---------------------------------------------------------------------------
# Crop inference
# ---------------------------------------------------------------------------

def _predict_crop(
    session,
    rgb: np.ndarray,
    *,
    conf_thr: float,
    iou_thr: float,
    max_det: int,
) -> list[np.ndarray]:
    """Run FastSAM ONNX on a single RGB crop, return list of binary masks."""
    orig_h, orig_w = rgb.shape[:2]

    # Read required input size from the model itself
    input_meta = session.get_inputs()[0]
    _, _, model_h, model_w = input_meta.shape
    imgsz = int(model_h)


    # Pad to square and resize
    side = max(orig_h, orig_w)
    padded = np.full((side, side, 3), 255, dtype=np.uint8)
    padded[:orig_h, :orig_w] = rgb

    resized = cv2.resize(padded, (imgsz, imgsz), interpolation=cv2.INTER_LINEAR)
    blob = resized.astype(np.float32) / 255.0
    blob = blob.transpose(2, 0, 1)[np.newaxis]   # [1,3,H,W]

    input_name = session.get_inputs()[0].name
    outputs = session.run(None, {input_name: blob})
    output0 = outputs[0][0]   # [4+nc+32, N]  (nc=1 for FastSAM)
    protos   = outputs[1][0]  # [32, mh, mw]

    # Decode
    num_coeffs = 32
    num_classes = output0.shape[0] - 4 - num_coeffs

    class_logit = output0[4: 4 + num_classes, :]
    class_scores = class_logit.max(axis=0)
    class_ids    = class_logit.argmax(axis=0)
    coeffs       = output0[-32:, :]

    keep = class_scores >= conf_thr
    if not np.any(keep):
        return []

    boxes_raw    = output0[:4, keep]
    class_scores = class_scores[keep]
    class_ids    = class_ids[keep]
    coeffs       = coeffs[:, keep]

    boxes_xyxy = _cxcywh_to_xyxy(boxes_raw.T)
    indices    = _nms(boxes_xyxy, class_scores, iou_thr, max_det)
    if not indices:
        return []

    coeffs_sel  = coeffs[:, indices]
    _, ph, pw   = protos.shape
    proto_flat  = protos.reshape(32, -1)
    mask_flat   = _sigmoid(coeffs_sel.T @ proto_flat)
    masks_proto = mask_flat.reshape(-1, ph, pw)

    result_masks: list[np.ndarray] = []
    for i, mask_f in enumerate(masks_proto):
        # Upsample to padded size
        mask_up = cv2.resize(
            mask_f.astype(np.float32),
            (side, side),
            interpolation=cv2.INTER_LANCZOS4,
        )
        # Crop back to original content
        mask_up = mask_up[:orig_h, :orig_w]
        binary  = mask_up > 0.5
        if np.any(binary):
            result_masks.append(binary)

    return result_masks


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _resolve_fastsam_model(model_name: str) -> str:
    candidate = Path(model_name)
    if candidate.is_absolute() and candidate.exists():
        return str(candidate)
    if candidate.exists():
        return str(candidate.resolve())
    backend_root = Path(__file__).resolve().parents[2]
    repo_root    = backend_root.parent
    for base in (backend_root, backend_root / "model", repo_root, repo_root / "model"):
        resolved = base / model_name
        if resolved.exists():
            return str(resolved)
    return model_name
