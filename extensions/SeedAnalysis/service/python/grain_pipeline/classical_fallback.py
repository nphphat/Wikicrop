from __future__ import annotations

import cv2
import numpy as np

from .config import bool_param, float_param, int_param
from .yolo_segment import InstanceMask


def augment_low_recall_instances(
    rgb: np.ndarray,
    instances: list[InstanceMask],
    params: dict,
) -> tuple[list[InstanceMask], dict]:
    """Add conservative classical masks when YOLO falls off on pale thin seeds."""
    stats = {
        "enabled": bool_param(params, "enableClassicalFallback", True),
        "applied": False,
        "reason": "disabled",
        "yolo_seed_count": _seed_count(instances),
        "classical_candidate_count": 0,
        "dilate_iterations": int_param(params, "classicalFallbackDilateIterations", 1, 0, 3),
        "added_count": 0,
    }
    if not stats["enabled"]:
        return instances, stats

    max_yolo = int_param(params, "classicalFallbackMaxYoloCandidates", 12, 0, 5000)
    min_classical = int_param(params, "classicalFallbackMinCandidates", 25, 1, 5000)
    if stats["yolo_seed_count"] > max_yolo:
        stats["reason"] = "yolo_candidate_count_ok"
        return instances, stats

    classical = _light_seed_masks(rgb, params)
    stats["classical_candidate_count"] = len(classical)
    if len(classical) < min_classical:
        stats["reason"] = "not_enough_classical_candidates"
        return instances, stats

    max_added = int_param(params, "classicalFallbackMaxAdded", 180, 1, 5000)
    confidence = float_param(params, "classicalFallbackConfidence", 0.085, 0.01, 0.5)
    merged = list(instances)
    added = 0
    for mask in classical:
        if added >= max_added:
            break
        if _duplicates_existing(mask, merged):
            continue
        merged.append(
            InstanceMask(
                mask=mask.astype(bool),
                confidence=confidence,
                class_id=0,
                class_name="seed",
                source="classical_light_seed_fallback",
                bbox=_bbox_from_mask(mask),
            )
        )
        added += 1

    stats["added_count"] = added
    stats["applied"] = added > 0
    stats["reason"] = "applied" if added > 0 else "all_classical_duplicates"
    return merged, stats


def _seed_count(instances: list[InstanceMask]) -> int:
    return sum(1 for item in instances if int(item.class_id) == 0 or str(item.class_name).lower() == "seed")


def _bbox_from_mask(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    x1 = int(xs.min())
    y1 = int(ys.min())
    x2 = int(xs.max()) + 1
    y2 = int(ys.max()) + 1
    return x1, y1, x2 - x1, y2 - y1


def _light_seed_masks(rgb: np.ndarray, params: dict) -> list[np.ndarray]:
    if rgb.size == 0:
        return []
    height, width = rgb.shape[:2]
    image_area = max(1, height * width)
    short_side = max(1, min(height, width))

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    background_sigma = float_param(params, "classicalFallbackBackgroundSigma", 15.0, 3.0, 80.0)
    background = cv2.GaussianBlur(gray, (0, 0), background_sigma)
    local_bright = cv2.subtract(gray, background)

    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    saturation = hsv[..., 1]
    value = hsv[..., 2]

    percentile = float_param(params, "classicalFallbackBrightPercentile", 96.0, 70.0, 99.5)
    min_delta = float_param(params, "classicalFallbackMinBrightDelta", 6.0, 0.0, 80.0)
    threshold = max(min_delta, float(np.percentile(local_bright, percentile)))
    binary = (
        (local_bright >= threshold)
        | ((saturation > 35) & (value > 100) & (local_bright >= max(4.0, min_delta * 0.75)))
    ).astype(np.uint8)

    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)

    connected_count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    min_area = max(int_param(params, "minArea", 20), int(round(image_area * 0.00009)))
    max_area = min(int_param(params, "maxArea", 200000), max(650, int(round(image_area * 0.0042))))
    min_length = max(7.0, short_side * 0.016)
    min_width = max(2.0, short_side * 0.0045)
    max_width = max(28.0, short_side * 0.065)
    max_aspect = float_param(params, "classicalFallbackMaxAspect", 18.0, 2.0, 50.0)

    masks: list[np.ndarray] = []
    for label_id in range(1, connected_count):
        area = int(stats[label_id, cv2.CC_STAT_AREA])
        if area < min_area or area > max_area:
            continue
        mask = labels == label_id
        metrics = _mask_metrics(mask)
        if metrics is None:
            continue
        if not _passes_shape_gate(metrics, min_area, max_area, min_length, min_width, max_width, max_aspect):
            continue
        masks.append(_dilate_mask(mask, int_param(params, "classicalFallbackDilateIterations", 1, 0, 3)))
    return masks


def _mask_metrics(mask: np.ndarray) -> dict | None:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    rect = cv2.minAreaRect(contour)
    rect_w, rect_h = rect[1]
    length = max(float(rect_w), float(rect_h), 1.0)
    width = max(min(float(rect_w), float(rect_h)), 1.0)
    x, y, w, h = cv2.boundingRect(contour)
    area = int(np.count_nonzero(mask))
    hull = cv2.convexHull(contour)
    hull_area = max(float(cv2.contourArea(hull)), 1.0)
    return {
        "area": area,
        "length": length,
        "width": width,
        "aspect": length / width,
        "extent": area / max(w * h, 1),
        "solidity": min(area / hull_area, 1.0),
    }


def _passes_shape_gate(
    metrics: dict,
    min_area: int,
    max_area: int,
    min_length: float,
    min_width: float,
    max_width: float,
    max_aspect: float,
) -> bool:
    area = float(metrics["area"])
    length = float(metrics["length"])
    width = float(metrics["width"])
    aspect = float(metrics["aspect"])
    extent = float(metrics["extent"])
    solidity = float(metrics["solidity"])
    return bool(
        min_area <= area <= max_area
        and length >= min_length
        and min_width <= width <= max_width
        and 1.2 <= aspect <= max_aspect
        and extent >= 0.18
        and solidity >= 0.45
    )


def _duplicates_existing(mask: np.ndarray, instances: list[InstanceMask]) -> bool:
    bbox = _bbox(mask)
    if bbox is None:
        return True
    area = int(np.count_nonzero(mask))
    for instance in instances:
        other_bbox = _bbox(instance.mask)
        if other_bbox is None or not _bbox_intersects(bbox, other_bbox):
            continue
        other_area = int(np.count_nonzero(instance.mask))
        inter = int(np.count_nonzero(np.logical_and(mask, instance.mask)))
        if inter == 0:
            continue
        union = max(area + other_area - inter, 1)
        smaller = max(min(area, other_area), 1)
        if inter / union >= 0.30 or inter / smaller >= 0.58:
            return True
    return False


def _dilate_mask(mask: np.ndarray, iterations: int) -> np.ndarray:
    if iterations <= 0:
        return mask
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    return cv2.dilate(mask.astype(np.uint8), kernel, iterations=iterations).astype(bool)


def _bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def _bbox_intersects(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return a[0] < b[2] and a[2] > b[0] and a[1] < b[3] and a[3] > b[1]
