from __future__ import annotations

import math
from dataclasses import replace

import cv2
import numpy as np

from .config import bool_param, float_param
from .yolo_segment import InstanceMask


def recover_reference_marker(
    rgb: np.ndarray,
    instances: list[InstanceMask],
    params: dict,
) -> tuple[list[InstanceMask], dict]:
    stats = {
        "enabled": bool_param(params, "enableReferenceRecovery"),
        "applied": False,
        "method": "none",
        "candidate_count": 0,
        "diameter_px": None,
        "processed_line": None,
        "skip_reason": "",
    }
    if not stats["enabled"] or not instances:
        return instances, stats

    existing_refs = [item for item in instances if _is_reference(item)]
    if existing_refs:
        selected = max(existing_refs, key=lambda item: item.confidence)
        line = _edge_diameter_line(rgb, selected.mask) or _diameter_line(selected.mask)
        stats.update(
            {
                "method": "model",
                "candidate_count": len(existing_refs),
                "diameter_px": round(float(line["pixels"]), 4) if line else None,
                "processed_line": line,
                "edge_refined": bool(line and line.get("edge_refined")),
            }
        )
        return instances, stats

    background_luma = _border_luma(rgb)
    stats["background_luma"] = round(background_luma, 3)
    if background_luma > float_param(params, "referenceRecoveryMaxBackgroundLuma"):
        stats["skip_reason"] = "background_too_bright"
        return instances, stats

    seed_areas = np.asarray(
        [np.count_nonzero(item.mask) for item in instances if np.any(item.mask)],
        dtype=np.float64,
    )
    median_area = float(np.median(seed_areas)) if seed_areas.size else 0.0
    min_area_ratio = float_param(params, "referenceRecoveryMinAreaRatio")
    max_aspect = float_param(params, "referenceRecoveryMaxAspect")
    min_circularity = float_param(params, "referenceRecoveryMinCircularity")

    relabel_candidates: list[tuple[float, int, dict]] = []
    for index, item in enumerate(instances):
        shape = _shape_metrics(item.mask)
        if shape is None:
            continue
        area_ratio = shape["area"] / max(median_area, 1.0)
        if (
            area_ratio >= min_area_ratio
            and shape["aspect"] <= max_aspect
            and shape["circularity"] >= min_circularity
            and shape["solidity"] >= 0.82
            and not shape["touches_border"]
        ):
            score = area_ratio + shape["circularity"] * 2.0 - abs(shape["aspect"] - 1.0)
            relabel_candidates.append((score, index, shape))

    stats["candidate_count"] = len(relabel_candidates)
    if relabel_candidates:
        _, index, shape = max(relabel_candidates, key=lambda value: value[0])
        recovered = replace(
            instances[index],
            class_id=1,
            class_name="Ref",
            source=f"{instances[index].source}_ref_relabel",
        )
        updated = list(instances)
        updated[index] = recovered
        line = _edge_diameter_line(rgb, recovered.mask) or _diameter_line(recovered.mask)
        stats.update(
            {
                "applied": True,
                "method": "relabel_large_round_mask",
                "diameter_px": round(float(line["pixels"]), 4) if line else round(float(shape["diameter"]), 4),
                "processed_line": line,
                "edge_refined": bool(line and line.get("edge_refined")),
            }
        )
        return updated, stats

    circle = _detect_reference_circle(rgb, instances, params)
    if circle is None:
        return instances, stats

    center_x, center_y, radius, score, candidate_count = circle
    height, width = rgb.shape[:2]
    yy, xx = np.ogrid[:height, :width]
    mask = (xx - center_x) ** 2 + (yy - center_y) ** 2 <= radius**2
    x1 = max(0, int(math.floor(center_x - radius)))
    y1 = max(0, int(math.floor(center_y - radius)))
    x2 = min(width, int(math.ceil(center_x + radius)) + 1)
    y2 = min(height, int(math.ceil(center_y + radius)) + 1)
    recovered = InstanceMask(
        mask=mask,
        confidence=max(0.05, min(0.99, score)),
        class_id=1,
        class_name="Ref",
        source="circle_ref_recovery",
        bbox=(x1, y1, x2 - x1, y2 - y1),
    )
    line = {
        "x1": round(center_x - radius, 3),
        "y1": round(center_y, 3),
        "x2": round(center_x + radius, 3),
        "y2": round(center_y, 3),
        "pixels": round(radius * 2.0, 3),
        "edge_refined": False,
    }
    stats.update(
        {
            "applied": True,
            "method": "circle_recovery",
            "candidate_count": candidate_count,
            "diameter_px": round(float(line["pixels"]), 4),
            "processed_line": line,
            "edge_refined": bool(line.get("edge_refined")),
        }
    )
    return [*instances, recovered], stats


def _detect_reference_circle(
    rgb: np.ndarray,
    instances: list[InstanceMask],
    params: dict,
) -> tuple[float, float, float, float, int] | None:
    height, width = rgb.shape[:2]
    min_side = min(height, width)
    min_radius = max(6, int(round(min_side * float_param(params, "referenceRecoveryMinRadiusRatio"))))
    max_radius = max(
        min_radius + 2,
        int(round(min_side * float_param(params, "referenceRecoveryMaxRadiusRatio"))),
    )
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (7, 7), 1.5)
    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1.1,
        minDist=max(20.0, min_side * 0.12),
        param1=100,
        param2=float_param(params, "referenceRecoveryHoughThreshold"),
        minRadius=min_radius,
        maxRadius=max_radius,
    )
    if circles is None:
        return None

    union = np.zeros((height, width), dtype=bool)
    centroids: list[tuple[float, float]] = []
    for item in instances:
        union |= item.mask.astype(bool, copy=False)
        ys, xs = np.nonzero(item.mask)
        if xs.size:
            centroids.append((float(xs.mean()), float(ys.mean())))

    yy, xx = np.ogrid[:height, :width]
    image_center_x = (width - 1) / 2.0
    image_center_y = (height - 1) / 2.0
    max_center_distance = math.hypot(image_center_x, image_center_y)
    target_radius = min_side * 0.073
    candidates = []
    for rank, (center_x, center_y, radius) in enumerate(circles[0]):
        center_x = float(center_x)
        center_y = float(center_y)
        radius = float(radius)
        if (
            center_x - radius < 1
            or center_y - radius < 1
            or center_x + radius >= width - 1
            or center_y + radius >= height - 1
        ):
            continue
        distance_squared = (xx - center_x) ** 2 + (yy - center_y) ** 2
        inner = distance_squared <= (radius * 0.88) ** 2
        ring = np.logical_and(
            distance_squared >= (radius * 1.08) ** 2,
            distance_squared <= (radius * 1.38) ** 2,
        )
        if not np.any(inner) or not np.any(ring):
            continue
        contrast = float(np.mean(gray[inner]) - np.mean(gray[ring]))
        coverage = float(np.count_nonzero(union & inner) / max(np.count_nonzero(inner), 1))
        centroid_hits = sum(
            (point_x - center_x) ** 2 + (point_y - center_y) ** 2 <= (radius * 0.78) ** 2
            for point_x, point_y in centroids
        )
        if centroid_hits > 2 or contrast < float_param(params, "referenceRecoveryMinContrast"):
            continue
        center_distance = math.hypot(center_x - image_center_x, center_y - image_center_y)
        centrality = 1.0 - min(1.0, center_distance / max(max_center_distance, 1.0))
        radius_fit = 1.0 - min(1.0, abs(radius - target_radius) / max(target_radius, 1.0))
        rank_bonus = 1.0 / (1.0 + rank)
        score = (
            0.15
            + min(max(contrast, 0.0), 80.0) / 240.0
            + centrality * 0.12
            + radius_fit * 0.35
            + rank_bonus * 0.05
            + (1.0 - coverage) * 0.08
            - centroid_hits * 0.10
        )
        candidates.append((score, center_x, center_y, radius))
    if not candidates:
        return None
    score, center_x, center_y, radius = max(candidates, key=lambda value: value[0])
    calibrated_radius = max(target_radius * 0.90, min(radius, target_radius * 1.15))
    return center_x, center_y, calibrated_radius, score, len(candidates)


def _shape_metrics(mask: np.ndarray) -> dict | None:
    mask_u8 = mask.astype(np.uint8, copy=False)
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    area = float(np.count_nonzero(mask_u8))
    perimeter = float(cv2.arcLength(contour, True))
    hull_area = max(float(cv2.contourArea(cv2.convexHull(contour))), 1.0)
    (_, _), (rect_width, rect_height), _ = cv2.minAreaRect(contour)
    short_side = max(min(float(rect_width), float(rect_height)), 1.0)
    long_side = max(float(rect_width), float(rect_height))
    height, width = mask_u8.shape[:2]
    x, y, box_width, box_height = cv2.boundingRect(contour)
    return {
        "area": area,
        "circularity": 4.0 * math.pi * area / max(perimeter * perimeter, 1.0),
        "solidity": area / hull_area,
        "aspect": long_side / short_side,
        "diameter": long_side,
        "touches_border": x <= 0 or y <= 0 or x + box_width >= width or y + box_height >= height,
    }


def _diameter_line(mask: np.ndarray) -> dict | None:
    mask_u8 = mask.astype(np.uint8, copy=False)
    contours, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    (center_x, center_y), (width, height), angle = cv2.minAreaRect(contour)
    diameter = max(float(width), float(height))
    if diameter <= 1.0:
        return None
    theta = math.radians(angle if width >= height else angle + 90.0)
    dx = math.cos(theta) * diameter / 2.0
    dy = math.sin(theta) * diameter / 2.0
    return {
        "x1": round(center_x - dx, 3),
        "y1": round(center_y - dy, 3),
        "x2": round(center_x + dx, 3),
        "y2": round(center_y + dy, 3),
        "pixels": round(diameter, 3),
        "edge_refined": False,
    }


def _edge_diameter_line(rgb: np.ndarray, mask: np.ndarray) -> dict | None:
    ys, xs = np.nonzero(mask)
    if xs.size < 20:
        return None
    center_x = float(xs.mean())
    center_y = float(ys.mean())
    equivalent_radius = math.sqrt(float(xs.size) / math.pi)
    if equivalent_radius <= 3.0:
        return None

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    gray = cv2.GaussianBlur(gray, (5, 5), 1.0)
    height, width = gray.shape[:2]
    radii = np.linspace(equivalent_radius * 0.60, equivalent_radius * 1.65, 80)
    axes: list[tuple[float, float, float, float, float]] = []
    for angle in np.linspace(0.0, math.pi, 180, endpoint=False):
        cosine = math.cos(float(angle))
        sine = math.sin(float(angle))
        side_radii = []
        side_scores = []
        for direction in (-1.0, 1.0):
            sample_x = np.clip(
                np.rint(center_x + direction * cosine * radii),
                0,
                width - 1,
            ).astype(np.int32)
            sample_y = np.clip(
                np.rint(center_y + direction * sine * radii),
                0,
                height - 1,
            ).astype(np.int32)
            profile = gray[sample_y, sample_x].astype(np.float32)
            drops = profile[:-1] - profile[1:]
            best_index = int(np.argmax(drops))
            side_radii.append(float(radii[best_index]))
            side_scores.append(float(drops[best_index]))
        if min(side_scores) >= 3.0:
            axes.append(
                (
                    side_radii[0] + side_radii[1],
                    angle,
                    side_radii[0],
                    side_radii[1],
                    min(side_scores),
                )
            )
    if len(axes) < 12:
        return None
    axes.sort(key=lambda item: item[0])
    selected = axes[int(round((len(axes) - 1) * 0.65))]
    diameter, angle, radius_negative, radius_positive, edge_score = selected
    cosine = math.cos(float(angle))
    sine = math.sin(float(angle))
    return {
        "x1": round(center_x - cosine * radius_negative, 3),
        "y1": round(center_y - sine * radius_negative, 3),
        "x2": round(center_x + cosine * radius_positive, 3),
        "y2": round(center_y + sine * radius_positive, 3),
        "pixels": round(float(diameter), 3),
        "edge_refined": True,
        "edge_score": round(float(edge_score), 3),
    }


def reference_suggestion(stats: dict, scale: float) -> dict | None:
    line = stats.get("processed_line")
    if not isinstance(line, dict) or float(line.get("pixels", 0) or 0) <= 1.0:
        return None
    safe_scale = max(float(scale), 1e-6)
    return {
        "available": True,
        "source": str(stats.get("method") or "reference_recovery"),
        "pixel_space": "original",
        "x1": round(float(line["x1"]) / safe_scale, 3),
        "y1": round(float(line["y1"]) / safe_scale, 3),
        "x2": round(float(line["x2"]) / safe_scale, 3),
        "y2": round(float(line["y2"]) / safe_scale, 3),
        "pixels": round(float(line["pixels"]) / safe_scale, 3),
        "processed": line,
        "confidence": None,
        "class_id": 1,
        "class_name": "Ref",
        "detected_class_id": 1,
        "detected_class_name": "Ref",
    }


def _is_reference(instance: InstanceMask) -> bool:
    return int(instance.class_id) == 1 or str(instance.class_name).strip().lower() in {"ref", "reference"}


def _border_luma(rgb: np.ndarray) -> float:
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    height, width = gray.shape[:2]
    border = max(2, int(round(min(height, width) * 0.06)))
    values = np.concatenate(
        [
            gray[:border, :].ravel(),
            gray[-border:, :].ravel(),
            gray[:, :border].ravel(),
            gray[:, -border:].ravel(),
        ]
    )
    return float(np.median(values)) if values.size else 255.0
