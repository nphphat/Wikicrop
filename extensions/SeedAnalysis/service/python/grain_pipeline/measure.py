from __future__ import annotations

import csv
from io import StringIO

import cv2
import numpy as np

from .config import CSV_COLUMNS, bool_param, float_param, int_param
from .yolo_segment import InstanceMask

SEED_CLASS_IDS = {0}
SEED_CLASS_NAMES = {"seed"}
QC_MAD_Z_THRESHOLD = 4.0
QC_RELAXED_MAD_Z_THRESHOLD = 8.0
QC_MIN_OUTLIER_METRICS = 2


def filter_and_measure(
    instances: list[InstanceMask],
    params: dict,
    scale: float,
    rgb: np.ndarray | None = None,
) -> tuple[np.ndarray, list[dict], int]:
    pixel_to_mm = calibration_factor(params, scale)

    if not instances:
        return np.zeros((1, 1), dtype=np.int32), [], 0

    height, width = instances[0].mask.shape[:2]
    image_area = max(1, height * width)
    labels = np.zeros((height, width), dtype=np.int32)
    measurements: list[dict] = []
    reference_line = reference_line_points(params, scale, width, height)
    excluded_reference_object_count = 0
    candidates: list[tuple[InstanceMask, dict, dict]] = []

    for instance in sorted(instances, key=lambda item: item.confidence, reverse=True):
        if not is_seed_instance(instance):
            continue
        if reference_line is not None and is_reference_object(instance.mask, reference_line):
            excluded_reference_object_count += 1
            continue
        metrics = mask_metrics(instance.mask)
        if metrics is None:
            continue
        color = mask_color_metrics(rgb, instance.mask)
        if not _passes_candidate_filter(instance.confidence, metrics, color, image_area, params, None):
            continue
        candidates.append((instance, metrics, color))

    size_reference = _size_reference_for(candidates, params)
    candidates = _split_merged_candidates(candidates, params, size_reference, rgb)
    size_reference = _size_reference_for(candidates, params) or size_reference
    selected = [
        candidate
        for candidate in candidates
        if _passes_candidate_filter(candidate[0].confidence, candidate[1], candidate[2], image_area, params, size_reference)
    ]
    selected.sort(key=_candidate_priority, reverse=True)

    for instance, _, _ in selected:
        available = np.logical_and(instance.mask, labels == 0)
        metrics = mask_metrics(available)
        if metrics is None:
            continue
        color = mask_color_metrics(rgb, available)
        if not _passes_candidate_filter(instance.confidence, metrics, color, image_area, params, size_reference):
            continue

        item_id = len(measurements) + 1
        labels[available] = item_id
        measurement = {
            "id": item_id,
            **metrics,
            "area_mm2": round(metrics["area_px"] * pixel_to_mm * pixel_to_mm, 6) if pixel_to_mm else None,
            "length_mm": round(metrics["length_px"] * pixel_to_mm, 6) if pixel_to_mm else None,
            "width_mm": round(metrics["width_px"] * pixel_to_mm, 6) if pixel_to_mm else None,
            "confidence": round(instance.confidence, 6),
            "class_id": instance.class_id,
            "class_name": instance.class_name,
        }
        measurements.append(measurement)

    return labels, measurements, excluded_reference_object_count


def _passes_candidate_filter(
    confidence: float,
    metrics: dict,
    color: dict,
    image_area: int,
    params: dict,
    size_reference: dict | None,
) -> bool:
    min_area = int_param(params, "minArea")
    max_area = int_param(params, "maxArea")
    max_aspect = float_param(params, "maxSegmentAspectRatio")
    min_solidity = float_param(params, "minSegmentSolidity")
    min_extent = float_param(params, "minSegmentExtent")
    area = int(metrics["area_px"])
    if area < min_area or area > max_area:
        return False
    if metrics["aspect_ratio"] > max_aspect:
        return False
    if metrics["solidity"] < min_solidity or metrics["extent"] < min_extent:
        return False
    if not _passes_confidence_aware_shape_filter(confidence, metrics):
        return False
    if bool_param(params, "enableSkinReject") and _looks_like_large_skin_object(area, image_area, color, params, size_reference):
        return False
    if _is_dynamic_non_seed_size(metrics, color, image_area, params, size_reference):
        return False
    if _is_low_confidence_oversize(confidence, metrics, size_reference):
        return False
    return True


def _passes_confidence_aware_shape_filter(confidence: float, metrics: dict) -> bool:
    if confidence >= 0.18:
        return metrics["solidity"] >= 0.5 and metrics["extent"] >= 0.2 and metrics["aspect_ratio"] <= 10.5
    if confidence >= 0.12:
        return metrics["solidity"] >= 0.48 and metrics["extent"] >= 0.22 and metrics["aspect_ratio"] <= 12.0
    if confidence >= 0.08:
        return metrics["solidity"] >= 0.56 and metrics["extent"] >= 0.25 and metrics["aspect_ratio"] <= 10.0
    return metrics["solidity"] >= 0.62 and metrics["extent"] >= 0.30 and metrics["aspect_ratio"] <= 8.0


def _looks_like_large_skin_object(
    area: int,
    image_area: int,
    color: dict,
    params: dict,
    size_reference: dict | None,
) -> bool:
    skin_ratio = float(color.get("skin_ratio", 0.0) or 0.0)
    reference_area = float(size_reference.get("area", 0.0) if size_reference else 0.0)
    large_skin_floor = max(1800.0, image_area * 0.018, reference_area * 4.0)
    strong_skin_floor = max(1000.0, image_area * 0.012, reference_area * 3.0)
    if skin_ratio >= float_param(params, "skinRejectRatio") and area >= large_skin_floor:
        return True
    if skin_ratio >= float_param(params, "strongSkinRejectRatio") and area >= strong_skin_floor:
        return True
    return False


def _is_dynamic_non_seed_size(
    metrics: dict,
    color: dict,
    image_area: int,
    params: dict,
    reference: dict | None,
) -> bool:
    if reference is None:
        return False
    area = float(metrics["area_px"])
    too_large = area > float(reference["area_upper"])
    covers_image = area / max(image_area, 1) > 0.08
    return bool(too_large and covers_image)


def _is_low_confidence_oversize(confidence: float, metrics: dict, reference: dict | None) -> bool:
    if reference is None or confidence >= 0.08:
        return False
    return float(metrics["area_px"]) > float(reference["area"]) * 1.65


def _size_reference_for(candidates: list[tuple[InstanceMask, dict, dict]], params: dict) -> dict | None:
    if not bool_param(params, "enableAdaptiveThresholds"):
        return None
    min_candidates = int_param(params, "adaptiveMinCandidates")
    if len(candidates) < min_candidates:
        return None
    reference_candidates = [candidate for candidate in candidates if float(candidate[2].get("skin_ratio", 0.0) or 0.0) < 0.35]
    if len(reference_candidates) < min_candidates:
        reference_candidates = candidates
    areas = [float(candidate[1]["area_px"]) for candidate in reference_candidates]
    lengths = [float(candidate[1]["length_px"]) for candidate in reference_candidates]
    widths = [float(candidate[1]["width_px"]) for candidate in reference_candidates]
    aspects = [float(candidate[1]["aspect_ratio"]) for candidate in reference_candidates]
    area_median = float(np.median(areas))
    length_median = float(np.median(lengths))
    width_median = float(np.median(widths))
    aspect_median = float(np.median(aspects))
    area_mad_ratio = _mad_ratio(areas, area_median)
    length_mad_ratio = _mad_ratio(lengths, length_median)
    width_mad_ratio = _mad_ratio(widths, width_median)
    split_z = float_param(params, "mergedSplitMadZ")
    return {
        "area": area_median,
        "length": length_median,
        "width": width_median,
        "split_enabled": bool(
            aspect_median >= 1.75
            and area_mad_ratio <= 0.35
            and length_mad_ratio <= 0.25
            and width_mad_ratio <= 0.25
        ),
        "area_split_upper": _robust_upper(
            areas,
            center=area_median,
            z=split_z,
            min_multiplier=float_param(params, "mergedSplitAreaRatio"),
        ),
        "length_split_upper": _robust_upper(
            lengths,
            center=length_median,
            z=split_z,
            min_multiplier=float_param(params, "mergedSplitLengthRatio"),
        ),
        "width_split_upper": _robust_upper(
            widths,
            center=width_median,
            z=split_z,
            min_multiplier=float_param(params, "mergedSplitWidthRatio"),
        ),
        "area_upper": _robust_upper(
            areas,
            center=area_median,
            z=float_param(params, "adaptiveMadZ"),
            min_multiplier=float_param(params, "dynamicAreaMultiplier"),
        ),
    }


def _robust_upper(values: list[float], *, center: float, z: float, min_multiplier: float) -> float:
    if not values:
        return center * min_multiplier
    deviations = np.abs(np.asarray(values, dtype=np.float64) - center)
    mad = float(np.median(deviations))
    robust_sigma = max(1.0, 1.4826 * mad)
    return max(center * min_multiplier, center + z * robust_sigma)


def _mad_ratio(values: list[float], center: float) -> float:
    if not values or center <= 1e-9:
        return 1.0
    deviations = np.abs(np.asarray(values, dtype=np.float64) - center)
    return float(np.median(deviations) / center)


def _split_merged_candidates(
    candidates: list[tuple[InstanceMask, dict, dict]],
    params: dict,
    reference: dict | None,
    rgb: np.ndarray | None,
) -> list[tuple[InstanceMask, dict, dict]]:
    if not bool_param(params, "enableMergedSeedSplit") or reference is None:
        return candidates
    split_candidates: list[tuple[InstanceMask, dict, dict]] = []
    for instance, metrics, color in candidates:
        parts = _split_instance_if_merged(instance, metrics, params, reference)
        if len(parts) == 1:
            split_candidates.append((instance, metrics, color))
            continue
        for part in parts:
            part_metrics = mask_metrics(part.mask)
            if part_metrics is None:
                continue
            split_candidates.append((part, part_metrics, mask_color_metrics(rgb, part.mask)))
    return split_candidates


def _split_instance_if_merged(
    instance: InstanceMask,
    metrics: dict,
    params: dict,
    reference: dict,
) -> list[InstanceMask]:
    max_parts = int_param(params, "mergedSplitMaxParts")
    parts = [instance]
    for _ in range(max_parts - 1):
        changed = False
        next_parts: list[InstanceMask] = []
        for part in parts:
            part_metrics = mask_metrics(part.mask)
            if part_metrics is None or not _should_try_merged_split(part_metrics, params, reference):
                next_parts.append(part)
                continue
            split_masks = _merged_split_mask(part.mask, params, reference, part_metrics)
            if len(split_masks) < 2 or len(next_parts) + len(split_masks) + (len(parts) - len(next_parts) - 1) > max_parts:
                next_parts.append(part)
                continue
            next_parts.extend(
                InstanceMask(
                    mask=split_mask,
                    confidence=part.confidence * 0.98,
                    class_id=part.class_id,
                    class_name=part.class_name,
                    source=f"{part.source}_split",
                )
                for split_mask in split_masks
            )
            changed = True
        parts = next_parts
        if not changed:
            break
    return parts if len(parts) > 1 else [instance]


def _should_try_merged_split(metrics: dict, params: dict, reference: dict) -> bool:
    if not bool(reference.get("split_enabled", False)):
        return False
    area = float(metrics["area_px"])
    length = float(metrics["length_px"])
    width = float(metrics["width_px"])
    area_large = area >= float(reference["area_split_upper"])
    length_large = length >= float(reference["length_split_upper"])
    width_large = width >= float(reference["width_split_upper"])
    return bool(area_large and (length_large or width_large))


def _merged_split_mask(mask: np.ndarray, params: dict, reference: dict, metrics: dict) -> list[np.ndarray]:
    target_parts = _expected_split_part_count(int(metrics["area_px"]), params, reference)
    if not _has_distance_split_evidence(mask, reference, target_parts, metrics):
        return [mask]
    marker_parts = _distance_marker_split_mask(mask, params, reference, target_parts)
    if len(marker_parts) > 1:
        return marker_parts
    return _projection_split_mask(mask, reference)


def _expected_split_part_count(area: int, params: dict, reference: dict) -> int:
    max_parts = max(2, int_param(params, "mergedSplitMaxParts"))
    area_ratio = area / max(float(reference["area"]), 1.0)
    # Bias slightly downward near half steps; over-splitting is worse than
    # leaving an uncertain cluster for the projection fallback/manual review.
    return int(np.clip(np.floor(area_ratio + 0.35), 2, max_parts))


def _has_distance_split_evidence(
    mask: np.ndarray,
    reference: dict,
    target_parts: int,
    metrics: dict,
) -> bool:
    core_count = _distance_core_component_count(mask, reference)
    if target_parts <= 2:
        return core_count >= 2
    if core_count >= 2:
        return True
    return float(metrics.get("extent", 1.0) or 1.0) <= 0.68


def _distance_core_component_count(mask: np.ndarray, reference: dict) -> int:
    ys, xs = np.nonzero(mask)
    if len(xs) < 2:
        return 0
    y1, y2 = int(ys.min()), int(ys.max()) + 1
    x1, x2 = int(xs.min()), int(xs.max()) + 1
    crop = mask[y1:y2, x1:x2].astype(np.uint8)
    distance = cv2.distanceTransform(crop, cv2.DIST_L2, 3)
    max_distance = float(distance.max()) if distance.size else 0.0
    if max_distance < 2.5:
        return 0
    core = ((crop > 0) & (distance >= max(2.0, max_distance * 0.65))).astype(np.uint8)
    component_count, _, stats, _ = cv2.connectedComponentsWithStats(core, connectivity=8)
    min_core_area = max(3, int(float(reference["width"]) * 0.25))
    return sum(1 for label in range(1, component_count) if int(stats[label, cv2.CC_STAT_AREA]) >= min_core_area)


def _distance_marker_split_mask(
    mask: np.ndarray,
    params: dict,
    reference: dict,
    target_parts: int,
) -> list[np.ndarray]:
    ys, xs = np.nonzero(mask)
    if len(xs) < 2:
        return [mask]

    y1, y2 = int(ys.min()), int(ys.max()) + 1
    x1, x2 = int(xs.min()), int(xs.max()) + 1
    crop = mask[y1:y2, x1:x2].astype(np.uint8)
    area = int(np.count_nonzero(crop))
    if area < 2:
        return [mask]

    distance = cv2.distanceTransform(crop, cv2.DIST_L2, 3)
    max_distance = float(distance.max()) if distance.size else 0.0
    if max_distance < 2.5:
        return [mask]

    peak_threshold = max(2.0, max_distance * 0.45)
    peak_ys, peak_xs = np.nonzero((crop > 0) & (distance >= peak_threshold))
    if len(peak_xs) < 2:
        return [mask]

    min_seed_distance = max(3.0, min(18.0, float(reference["width"]) * 0.45))
    min_seed_distance_sq = min_seed_distance * min_seed_distance
    seeds: list[tuple[float, float]] = []
    while len(seeds) < target_parts:
        best: tuple[float, float, float] | None = None
        for sx_raw, sy_raw in zip(peak_xs, peak_ys):
            sx = float(sx_raw)
            sy = float(sy_raw)
            base_score = float(distance[int(sy_raw), int(sx_raw)])
            if seeds:
                min_distance_sq = min((sx - ox) ** 2 + (sy - oy) ** 2 for ox, oy in seeds)
                if min_distance_sq < min_seed_distance_sq:
                    continue
                spread_score = min(float(np.sqrt(min_distance_sq)) / max(min_seed_distance, 1.0), 1.8)
                score = base_score * spread_score
            else:
                score = base_score
            if best is None or score > best[0]:
                best = (score, sx, sy)
        if best is None:
            break
        seeds.append((best[1], best[2]))
    if len(seeds) < 2:
        return [mask]

    point_ys, point_xs = np.nonzero(crop)
    seed_xs = np.asarray([seed[0] for seed in seeds], dtype=np.float64)
    seed_ys = np.asarray([seed[1] for seed in seeds], dtype=np.float64)
    distances_sq = (
        (point_xs[:, None].astype(np.float64) - seed_xs[None, :]) ** 2
        + (point_ys[:, None].astype(np.float64) - seed_ys[None, :]) ** 2
    )
    assignments = np.argmin(distances_sq, axis=1)

    crop_parts = [np.zeros_like(crop, dtype=bool) for _ in seeds]
    for part_index in range(len(seeds)):
        selected = assignments == part_index
        if np.any(selected):
            crop_parts[part_index][point_ys[selected], point_xs[selected]] = True

    part_areas = [int(np.count_nonzero(part)) for part in crop_parts]
    min_part_area = max(20, int(float(reference["area"]) * 0.28))
    if any(part_area < min_part_area for part_area in part_areas):
        return [mask]
    if min(part_areas) / max(sum(part_areas), 1) < 0.18:
        return [mask]
    if not _split_parts_are_plausible(crop_parts, reference, max_width_multiplier=1.90):
        return [mask]

    full_parts: list[np.ndarray] = []
    for crop_part in crop_parts:
        full_part = np.zeros_like(mask, dtype=bool)
        full_part[y1:y2, x1:x2] = crop_part
        full_parts.append(full_part)
    return full_parts


def _projection_split_mask(mask: np.ndarray, reference: dict) -> list[np.ndarray]:
    ys, xs = np.nonzero(mask)
    if len(xs) < 2:
        return [mask]
    points = np.column_stack([xs.astype(np.float64), ys.astype(np.float64)])
    centered = points - points.mean(axis=0)
    cov = np.cov(centered, rowvar=False)
    try:
        values, vectors = np.linalg.eigh(cov)
    except np.linalg.LinAlgError:
        return [mask]
    major = vectors[:, int(np.argmax(values))]
    minor = np.array([-major[1], major[0]], dtype=np.float64)
    candidates = [
        _split_mask_on_axis(mask, points, major, reference),
        _split_mask_on_axis(mask, points, minor, reference),
    ]
    candidates = [candidate for candidate in candidates if len(candidate[0]) == 2]
    if not candidates:
        return [mask]
    candidates.sort(key=lambda item: item[1])
    return candidates[0][0]


def _split_mask_on_axis(
    mask: np.ndarray,
    points: np.ndarray,
    axis: np.ndarray,
    reference: dict,
) -> tuple[list[np.ndarray], float]:
    projection = points @ axis
    proj_min = float(projection.min())
    proj_max = float(projection.max())
    span = proj_max - proj_min
    if span < 8:
        return [mask], 1.0
    bin_count = int(np.clip(np.ceil(span / 4.0), 12, 96))
    hist, edges = np.histogram(projection, bins=bin_count, range=(proj_min, proj_max))
    lo = max(2, int(bin_count * 0.2))
    hi = min(bin_count - 3, int(bin_count * 0.8))
    if hi <= lo:
        return [mask], 1.0
    min_part_area = max(20, int(float(reference["area"]) * 0.28))
    cumulative = np.cumsum(hist)
    best: tuple[float, int, float] | None = None
    for index in range(lo, hi + 1):
        left_area_at_bin = int(cumulative[index])
        right_area_at_bin = int(cumulative[-1] - left_area_at_bin)
        if left_area_at_bin < min_part_area or right_area_at_bin < min_part_area:
            continue
        balance = min(left_area_at_bin, right_area_at_bin) / max(int(cumulative[-1]), 1)
        if balance < 0.25:
            continue
        left_peak_at_bin = int(hist[:index + 1].max()) if index >= 0 else 0
        right_peak_at_bin = int(hist[index:].max()) if index < bin_count else 0
        peak_floor_at_bin = max(1, min(left_peak_at_bin, right_peak_at_bin))
        valley_ratio_at_bin = float(hist[index] / peak_floor_at_bin)
        score = valley_ratio_at_bin + abs(0.5 - balance) * 0.6
        if best is None or score < best[0]:
            best = (score, index, valley_ratio_at_bin)
    if best is None:
        return [mask], 1.0
    _, valley_index, valley_ratio = best
    left_peak = int(hist[:valley_index + 1].max()) if valley_index >= 0 else 0
    right_peak = int(hist[valley_index:].max()) if valley_index < bin_count else 0
    peak_floor = max(1, min(left_peak, right_peak))
    valley_ratio = min(valley_ratio, float(hist[valley_index] / peak_floor))
    threshold = float((edges[valley_index] + edges[valley_index + 1]) / 2.0)
    left = projection <= threshold
    right = ~left
    left_area = int(np.count_nonzero(left))
    right_area = int(np.count_nonzero(right))
    total = left_area + right_area
    if left_area < min_part_area or right_area < min_part_area:
        return [mask], 1.0
    if min(left_area, right_area) / max(total, 1) < 0.25:
        return [mask], 1.0
    if valley_ratio > 0.92 and total < float(reference["area"]) * 1.6:
        return [mask], valley_ratio
    h, w = mask.shape[:2]
    left_mask = np.zeros((h, w), dtype=bool)
    right_mask = np.zeros((h, w), dtype=bool)
    xs = points[:, 0].astype(np.int32)
    ys = points[:, 1].astype(np.int32)
    left_mask[ys[left], xs[left]] = True
    right_mask[ys[right], xs[right]] = True
    if not _split_parts_are_plausible([left_mask, right_mask], reference):
        return [mask], 1.0
    return [left_mask, right_mask], valley_ratio


def _split_parts_are_plausible(
    parts: list[np.ndarray],
    reference: dict,
    *,
    max_width_multiplier: float = 1.75,
) -> bool:
    min_aspect = max(1.35, float(reference["length"]) / max(float(reference["width"]), 1.0) * 0.45)
    max_width = float(reference["width"]) * max_width_multiplier
    min_length = float(reference["length"]) * 0.45
    for part in parts:
        metrics = mask_metrics(part)
        if metrics is None:
            return False
        if float(metrics["aspect_ratio"]) < min_aspect:
            return False
        if float(metrics["width_px"]) > max_width:
            return False
        if float(metrics["length_px"]) < min_length:
            return False
    return True


def _candidate_priority(candidate: tuple[InstanceMask, dict, dict]) -> float:
    instance, metrics, color = candidate
    area = max(float(metrics.get("area_px", 1) or 1), 1.0)
    skin_ratio = float(color.get("skin_ratio", 0.0) or 0.0)
    return float(instance.confidence) - float(np.log(area)) / 80.0 - skin_ratio * 0.35


def is_seed_instance(instance: InstanceMask) -> bool:
    return instance.class_id in SEED_CLASS_IDS or str(instance.class_name).strip().lower() in SEED_CLASS_NAMES


def mask_metrics(mask: np.ndarray) -> dict | None:
    area = int(np.count_nonzero(mask))
    if area <= 0:
        return None
    ys, xs = np.nonzero(mask)
    x, y, w, h = cv2.boundingRect(np.column_stack([xs, ys]).astype(np.int32))
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    hull = cv2.convexHull(contour)
    hull_area = max(float(cv2.contourArea(hull)), 1.0)
    rect = cv2.minAreaRect(contour)
    (rect_w, rect_h) = rect[1]
    length = max(float(rect_w), float(rect_h), 1.0)
    width = max(min(float(rect_w), float(rect_h)), 1.0)
    return {
        "area_px": area,
        "length_px": round(length, 3),
        "width_px": round(width, 3),
        "centroid_x": round(float(xs.mean()), 3),
        "centroid_y": round(float(ys.mean()), 3),
        "bbox_x": int(x),
        "bbox_y": int(y),
        "bbox_w": int(w),
        "bbox_h": int(h),
        "angle_deg": round(float(rect[2]), 3),
        "solidity": round(float(area / hull_area), 6),
        "extent": round(float(area / max(w * h, 1)), 6),
        "aspect_ratio": round(float(length / width), 6),
    }


def mask_color_metrics(rgb: np.ndarray | None, mask: np.ndarray) -> dict:
    if rgb is None or rgb.shape[:2] != mask.shape[:2]:
        return {"skin_ratio": 0.0, "luma": 0.0}
    selected = rgb[mask.astype(bool)]
    if selected.size == 0:
        return {"skin_ratio": 0.0, "luma": 0.0}
    pixels = selected.astype(np.float32)
    r = pixels[:, 0]
    g = pixels[:, 1]
    b = pixels[:, 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    max_channel = np.maximum.reduce([r, g, b])
    min_channel = np.minimum.reduce([r, g, b])
    cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    rgb_rule = (r > 70) & (g > 35) & (b > 20) & (r > g) & (r > b) & ((max_channel - min_channel) > 15)
    ycbcr_rule = (cr >= 135) & (cr <= 185) & (cb >= 75) & (cb <= 140)
    skin = rgb_rule & ycbcr_rule
    return {
        "skin_ratio": float(np.count_nonzero(skin) / max(len(pixels), 1)),
        "luma": float(np.mean(luma)),
    }


def calibration_factor(params: dict, scale: float) -> float:
    reference_pixels = float_param(params, "referencePixels")
    reference_mm = float_param(params, "referenceMm")
    if reference_pixels <= 0 or reference_mm <= 0:
        return 0.0
    pixel_space = str(params.get("referencePixelSpace") or "original").strip().lower()
    processed_pixels = reference_pixels * scale if pixel_space != "processed" else reference_pixels
    return reference_mm / max(processed_pixels, 1e-6)


def reference_line_points(params: dict, scale: float, width: int, height: int) -> tuple[int, int, int, int] | None:
    points = [
        float_param(params, "referenceX1"),
        float_param(params, "referenceY1"),
        float_param(params, "referenceX2"),
        float_param(params, "referenceY2"),
    ]
    if min(points) < 0:
        return None
    pixel_space = str(params.get("referencePixelSpace") or "original").strip().lower()
    coordinate_scale = scale if pixel_space != "processed" else 1.0
    x1, y1, x2, y2 = [int(round(value * coordinate_scale)) for value in points]
    if x1 == x2 and y1 == y2:
        return None
    return (
        max(0, min(width - 1, x1)),
        max(0, min(height - 1, y1)),
        max(0, min(width - 1, x2)),
        max(0, min(height - 1, y2)),
    )


def is_reference_object(mask: np.ndarray, line: tuple[int, int, int, int]) -> bool:
    x1, y1, x2, y2 = line
    distance = float(np.hypot(x2 - x1, y2 - y1))
    sample_count = max(2, int(np.ceil(distance)) + 1)
    xs = np.rint(np.linspace(x1, x2, sample_count)).astype(np.int32)
    ys = np.rint(np.linspace(y1, y2, sample_count)).astype(np.int32)
    line_coverage = float(np.count_nonzero(mask[ys, xs])) / float(sample_count)
    midpoint_inside = bool(mask[int(round((y1 + y2) / 2)), int(round((x1 + x2) / 2))])
    return midpoint_inside and line_coverage >= 0.55


def measurements_csv(measurements: list[dict]) -> str:
    buffer = StringIO()
    writer = csv.DictWriter(buffer, fieldnames=CSV_COLUMNS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for item in measurements:
        writer.writerow(item)
    return buffer.getvalue()


def summary_for(measurements: list[dict]) -> dict:
    if not measurements:
        return {
            "count": 0,
            "total_area_px": 0,
            "mean_area_px": 0,
            "mean_length_px": 0,
            "mean_width_px": 0,
            "mean_area_mm2": None,
            "mean_length_mm": None,
            "mean_width_mm": None,
            "std_area_px": 0,
            "std_length_px": 0,
            "std_width_px": 0,
            "std_area_mm2": None,
            "std_length_mm": None,
            "std_width_mm": None,
            "robust_std_area_px": 0,
            "robust_std_length_px": 0,
            "robust_std_width_px": 0,
            "robust_std_area_mm2": None,
            "robust_std_length_mm": None,
            "robust_std_width_mm": None,
            "cv_length_pct": 0,
            "cv_width_pct": 0,
            "qc": {
                "method": "median_mad_multimetric",
                "suspect_count": 0,
                "inlier_count": 0,
                "suspect_ids": [],
                "review_required": False,
                "suspect_ratio": 0,
                "robust_used_for_reporting": True,
                "threshold": QC_MAD_Z_THRESHOLD,
                "min_metrics": QC_MIN_OUTLIER_METRICS,
                "status": "ok",
            },
        }

    qc_threshold = _qc_mad_z_threshold(measurements)
    outlier_indices = _qc_outlier_indices(measurements, qc_threshold)
    suspect_ratio = len(outlier_indices) / len(measurements)
    robust_used_for_reporting = suspect_ratio <= 0.05
    for index, measurement in enumerate(measurements):
        measurement["qc_outlier"] = index in outlier_indices
        measurement["qc_reason"] = "size_outlier_mad_multimetric" if index in outlier_indices else ""

    inliers = [
        measurement
        for index, measurement in enumerate(measurements)
        if index not in outlier_indices
    ] or measurements

    def values(items: list[dict], name: str) -> np.ndarray:
        return np.asarray([float(item.get(name, 0) or 0) for item in items], dtype=np.float64)

    def mean(items: list[dict], name: str) -> float:
        return round(float(values(items, name).mean()), 6)

    def std(items: list[dict], name: str) -> float:
        data = values(items, name)
        return round(float(data.std(ddof=1)) if len(data) > 1 else 0.0, 6)

    def cv(items: list[dict], name: str) -> float:
        average = float(values(items, name).mean())
        return round(std(items, name) / average * 100, 3) if average > 0 else 0.0

    calibrated = measurements[0].get("length_mm") is not None
    def metric_mm(statistic, items: list[dict], name: str) -> float | None:
        return statistic(items, name) if calibrated else None

    return {
        "count": len(measurements),
        "total_area_px": int(sum(int(item.get("area_px", 0) or 0) for item in measurements)),
        "mean_area_px": mean(measurements, "area_px"),
        "mean_length_px": mean(measurements, "length_px"),
        "mean_width_px": mean(measurements, "width_px"),
        "mean_area_mm2": metric_mm(mean, measurements, "area_mm2"),
        "mean_length_mm": metric_mm(mean, measurements, "length_mm"),
        "mean_width_mm": metric_mm(mean, measurements, "width_mm"),
        "std_area_px": std(measurements, "area_px"),
        "std_length_px": std(measurements, "length_px"),
        "std_width_px": std(measurements, "width_px"),
        "std_area_mm2": metric_mm(std, measurements, "area_mm2"),
        "std_length_mm": metric_mm(std, measurements, "length_mm"),
        "std_width_mm": metric_mm(std, measurements, "width_mm"),
        "robust_mean_area_px": mean(inliers, "area_px"),
        "robust_mean_length_px": mean(inliers, "length_px"),
        "robust_mean_width_px": mean(inliers, "width_px"),
        "robust_mean_area_mm2": metric_mm(mean, inliers, "area_mm2"),
        "robust_mean_length_mm": metric_mm(mean, inliers, "length_mm"),
        "robust_mean_width_mm": metric_mm(mean, inliers, "width_mm"),
        "robust_std_area_px": std(inliers, "area_px"),
        "robust_std_length_px": std(inliers, "length_px"),
        "robust_std_width_px": std(inliers, "width_px"),
        "robust_std_area_mm2": metric_mm(std, inliers, "area_mm2"),
        "robust_std_length_mm": metric_mm(std, inliers, "length_mm"),
        "robust_std_width_mm": metric_mm(std, inliers, "width_mm"),
        "cv_length_pct": cv(inliers, "length_px"),
        "cv_width_pct": cv(inliers, "width_px"),
        "qc": {
            "method": "median_mad_multimetric",
            "threshold": qc_threshold,
            "min_metrics": QC_MIN_OUTLIER_METRICS,
            "suspect_count": len(outlier_indices),
            "inlier_count": len(inliers),
            "suspect_ids": [measurements[index]["id"] for index in sorted(outlier_indices)],
            "review_required": bool(outlier_indices),
            "suspect_ratio": round(suspect_ratio, 6),
            "robust_used_for_reporting": robust_used_for_reporting,
            "status": (
                "review_required"
                if not robust_used_for_reporting
                else ("suspects_flagged" if outlier_indices else "ok")
            ),
        },
    }


def _qc_mad_z_threshold(measurements: list[dict]) -> float:
    if len(measurements) < 5:
        return QC_MAD_Z_THRESHOLD

    def iqr_ratio(name: str) -> float:
        data = np.asarray([float(item.get(name, 0) or 0) for item in measurements], dtype=np.float64)
        median = float(np.median(data))
        if median <= 1e-9:
            return 0.0
        q1, q3 = np.percentile(data, [25, 75])
        return float((q3 - q1) / median)

    wide_metrics = sum(
        (
            iqr_ratio("area_px") >= 1.0,
            iqr_ratio("length_px") >= 0.65,
            iqr_ratio("width_px") >= 0.55,
        )
    )
    return QC_RELAXED_MAD_Z_THRESHOLD if wide_metrics >= 2 else QC_MAD_Z_THRESHOLD


def _qc_outlier_indices(measurements: list[dict], threshold: float) -> set[int]:
    if len(measurements) < 5:
        return set()
    outlier_counts = np.zeros(len(measurements), dtype=np.int32)
    for name in ("area_px", "length_px", "width_px"):
        data = np.asarray([float(item.get(name, 0) or 0) for item in measurements], dtype=np.float64)
        median = float(np.median(data))
        deviation = np.abs(data - median)
        mad = float(np.median(deviation))
        if mad <= 1e-9:
            outlier_counts += (deviation > 1e-9).astype(np.int32)
            continue
        robust_z = 0.6745 * deviation / mad
        outlier_counts += (robust_z > threshold).astype(np.int32)
    return set(np.nonzero(outlier_counts >= QC_MIN_OUTLIER_METRICS)[0].tolist())
