from __future__ import annotations

import csv
from io import StringIO

import cv2
import numpy as np

from .config import CSV_COLUMNS, bool_param, float_param, int_param
from .yolo_segment import InstanceMask

SEED_CLASS_IDS = {0}
SEED_CLASS_NAMES = {"seed"}
REFERENCE_CLASS_IDS = {1}
REFERENCE_CLASS_NAMES = {"ref", "reference"}
QC_MAD_Z_THRESHOLD = 4.0
QC_RELAXED_MAD_Z_THRESHOLD = 8.0
QC_MIN_OUTLIER_METRICS = 2


def filter_and_measure(
    instances: list[InstanceMask],
    params: dict,
    scale: float,
    rgb: np.ndarray | None = None,
) -> tuple[np.ndarray, list[dict], int, dict]:
    pixel_to_mm = calibration_factor(params, scale)

    if not instances:
        return np.zeros((1, 1), dtype=np.int32), [], 0, {
            "accepted_ref_class_seed_count": 0,
            "auto_excluded_non_seed_count": 0,
            "fragment_merge_count": 0,
            "suggested_reference": None,
        }

    height, width = instances[0].mask.shape[:2]
    image_area = max(1, height * width)
    labels = np.zeros((height, width), dtype=np.int32)
    measurements: list[dict] = []
    reference_line = reference_line_points(params, scale, width, height)
    excluded_reference_object_count = 0
    candidates: list[tuple[InstanceMask, dict, dict]] = []

    for instance in sorted(instances, key=lambda item: item.confidence, reverse=True):
        if not is_measurement_candidate_instance(instance):
            continue
        if reference_line is not None and is_reference_object(instance.mask, reference_line):
            excluded_reference_object_count += 1
            continue
        metrics = mask_metrics(instance.mask, instance.bbox)
        if metrics is None:
            continue
        color = mask_color_metrics(rgb, instance.mask, metrics)
        if not _passes_candidate_filter(
            instance.confidence,
            metrics,
            color,
            image_area,
            params,
            None,
            (width, height),
            source=instance.source,
        ):
            continue
        candidates.append((instance, metrics, color))

    size_reference = _size_reference_for(candidates, params)
    candidates, fragment_merge_count = _merge_fragment_candidates(
        candidates,
        params,
        size_reference,
        rgb,
        image_area,
        (width, height),
    )
    size_reference = _size_reference_for(candidates, params) or size_reference
    candidates = _split_merged_candidates(candidates, params, size_reference, rgb)
    size_reference = _size_reference_for(candidates, params) or size_reference
    marker_reference = size_reference or _size_reference_for(candidates, params, min_candidates=3)
    suggested_reference = _suggested_reference_line(candidates, image_area, marker_reference, (width, height), scale)
    satellite_fragment_indices = _satellite_fragment_indices(candidates, size_reference)
    auto_excluded_non_seed_count = sum(
        1
        for index, (candidate_instance, metrics, candidate_color) in enumerate(candidates)
        if index in satellite_fragment_indices
        or _is_implausible_reference_seed_candidate(candidate_instance, metrics, size_reference)
        or _is_adaptive_non_seed_artifact(metrics, candidate_color, image_area, marker_reference, (width, height))
        or _is_tile_edge_fragment(candidate_instance.source, candidate_instance.confidence, metrics, size_reference)
        or _is_tiny_dimension_fragment(candidate_instance.confidence, metrics, size_reference, candidate_instance.source)
        or _looks_like_seed_shadow(metrics, candidate_color, size_reference)
        or _looks_like_dark_background_artifact(candidate_instance.confidence, metrics, candidate_color, size_reference)
    )
    selected = [
        candidate
        for index, candidate in enumerate(candidates)
        if index not in satellite_fragment_indices
        and not _is_implausible_reference_seed_candidate(candidate[0], candidate[1], size_reference)
        and not _is_adaptive_non_seed_artifact(candidate[1], candidate[2], image_area, marker_reference, (width, height))
        and _passes_candidate_filter(
            candidate[0].confidence,
            candidate[1],
            candidate[2],
            image_area,
            params,
            size_reference,
            (width, height),
            source=candidate[0].source,
        )
    ]
    selected.sort(key=_candidate_priority, reverse=True)
    accepted_ref_class_seed_count = 0

    for instance, _, _ in selected:
        available = np.logical_and(instance.mask, labels == 0)
        metrics = mask_metrics(available, instance.bbox)
        if metrics is None:
            continue
        color = mask_color_metrics(rgb, available, metrics)
        if not _passes_candidate_filter(
            instance.confidence,
            metrics,
            color,
            image_area,
            params,
            size_reference,
            (width, height),
            source=instance.source,
        ):
            continue
        if _is_adaptive_non_seed_artifact(metrics, color, image_area, marker_reference, (width, height)):
            auto_excluded_non_seed_count += 1
            continue
        if _is_implausible_reference_seed_candidate(instance, metrics, size_reference):
            auto_excluded_non_seed_count += 1
            continue
        if _is_available_satellite_fragment(metrics, color, measurements, size_reference):
            auto_excluded_non_seed_count += 1
            continue

        item_id = len(measurements) + 1
        labels[available] = item_id
        if is_reference_class_instance(instance):
            accepted_ref_class_seed_count += 1
        measurement = {
            "id": item_id,
            **metrics,
            "area_mm2": round(metrics["area_px"] * pixel_to_mm * pixel_to_mm, 6) if pixel_to_mm else None,
            "length_mm": round(metrics["length_px"] * pixel_to_mm, 6) if pixel_to_mm else None,
            "width_mm": round(metrics["width_px"] * pixel_to_mm, 6) if pixel_to_mm else None,
            "confidence": round(instance.confidence, 6),
            "class_id": 0,
            "class_name": "seed",
            "detected_class_id": int(instance.class_id),
            "detected_class_name": str(instance.class_name),
            "quality_flags": _measurement_quality_flags(metrics, instance, (width, height)),
        }
        measurements.append(measurement)

    return labels, measurements, excluded_reference_object_count, {
        "accepted_ref_class_seed_count": accepted_ref_class_seed_count,
        "auto_excluded_non_seed_count": auto_excluded_non_seed_count,
        "fragment_merge_count": fragment_merge_count,
        "suggested_reference": suggested_reference,
    }

def _passes_candidate_filter(
    confidence: float,
    metrics: dict,
    color: dict,
    image_area: int,
    params: dict,
    size_reference: dict | None,
    image_size: tuple[int, int] | None = None,
    *,
    source: str = "",
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
    if (
        bool_param(params, "enableSkinReject")
        and _looks_like_large_skin_object(area, image_area, color, params, size_reference)
        and not _could_be_reference_marker_without_size(metrics, image_area)
    ):
        return False
    if _is_adaptive_non_seed_artifact(metrics, color, image_area, size_reference, image_size):
        return False
    if _is_tile_edge_fragment(source, confidence, metrics, size_reference):
        return False
    if _is_tiny_dimension_fragment(confidence, metrics, size_reference, source):
        return False
    if _looks_like_seed_shadow(metrics, color, size_reference):
        return False
    if _looks_like_dark_background_artifact(confidence, metrics, color, size_reference):
        return False
    if _is_dynamic_non_seed_size(metrics, color, image_area, params, size_reference):
        return False
    if _is_low_confidence_reference_fragment(confidence, metrics, size_reference):
        return False
    if _is_low_confidence_oversize(confidence, metrics, size_reference):
        return False
    return True


def _satellite_fragment_indices(candidates: list[tuple[InstanceMask, dict, dict]], reference: dict | None) -> set[int]:
    if reference is None or len(candidates) < 2:
        return set()
    ref_area = max(float(reference["area"]), 1.0)
    ref_length = max(float(reference["length"]), 1.0)
    ref_width = max(float(reference["width"]), 1.0)
    ref_aspect = ref_length / ref_width
    geometry_satellite_enabled = ref_aspect < 2.25
    max_gap = max(3.0, ref_width * 0.38)
    max_center_distance = max(ref_length * 0.82, ref_width * 2.2)
    anchors = [
        (index, candidate)
        for index, candidate in enumerate(candidates)
        if float(candidate[1]["area_px"]) >= ref_area * 0.55
    ]
    satellite_indices: set[int] = set()
    for index, candidate in enumerate(candidates):
        instance, metrics, color = candidate
        area = float(metrics["area_px"])
        area_ratio = area / ref_area
        looks_like_shadow = _looks_like_seed_shadow(metrics, color, reference)
        if ref_aspect < 1.65:
            tiny_fragment = area_ratio <= 0.24
        else:
            length_ratio = float(metrics["length_px"]) / ref_length
            width_ratio = float(metrics["width_px"]) / ref_width
            tiny_fragment = area_ratio <= 0.30 and (width_ratio <= 0.55 or length_ratio <= 0.72)
        small_suspicious = geometry_satellite_enabled and area_ratio <= 0.40 and (
            looks_like_shadow or float(instance.confidence) < 0.12
        )
        if not (tiny_fragment or small_suspicious):
            continue
        if float(metrics["length_px"]) > ref_length * 0.88 and float(metrics["width_px"]) > ref_width * 0.75:
            continue
        for anchor_index, anchor in anchors:
            if anchor_index == index:
                continue
            _, anchor_metrics, _ = anchor
            anchor_area = float(anchor_metrics["area_px"])
            if anchor_area < max(ref_area * 0.55, area * 1.8):
                continue
            if _bbox_gap(metrics, anchor_metrics) > max_gap:
                continue
            if _center_distance(metrics, anchor_metrics) > max_center_distance:
                continue
            if _combined_bbox_too_large(metrics, anchor_metrics, ref_length, ref_width):
                continue
            satellite_indices.add(index)
            break
    return satellite_indices


def _is_available_satellite_fragment(
    metrics: dict,
    color: dict,
    measurements: list[dict],
    reference: dict | None,
) -> bool:
    if reference is None or not measurements:
        return False
    ref_area = max(float(reference["area"]), 1.0)
    ref_length = max(float(reference["length"]), 1.0)
    ref_width = max(float(reference["width"]), 1.0)
    if ref_length / ref_width >= 1.65:
        return False
    area_ratio = float(metrics["area_px"]) / ref_area
    if area_ratio > 0.30:
        return False
    if not _looks_like_seed_shadow(metrics, color, reference) and float(metrics["length_px"]) > ref_length * 0.70:
        return False
    max_gap = max(3.0, ref_width * 0.38)
    max_center_distance = max(ref_length * 0.82, ref_width * 2.2)
    for measurement in measurements:
        if float(measurement.get("area_px", 0) or 0) < ref_area * 0.55:
            continue
        if _bbox_gap(metrics, measurement) <= max_gap and _center_distance(metrics, measurement) <= max_center_distance:
            return True
    return False


def _is_tile_edge_source(source: str) -> bool:
    source_value = str(source or "").strip().lower()
    return "tile" in source_value and "edge" in source_value


def _is_tile_edge_fragment(source: str, confidence: float, metrics: dict, reference: dict | None) -> bool:
    if not _is_tile_edge_source(source):
        return False
    if reference is None:
        return bool(float(confidence) < 0.10 and float(metrics["width_px"]) <= 8.0)
    ref_area = max(float(reference["area"]), 1.0)
    ref_length = max(float(reference["length"]), 1.0)
    ref_width = max(float(reference["width"]), 1.0)
    area_ratio = float(metrics["area_px"]) / ref_area
    length_ratio = float(metrics["length_px"]) / ref_length
    width_ratio = float(metrics["width_px"]) / ref_width
    ref_aspect = ref_length / ref_width

    if area_ratio <= 0.24 and (width_ratio <= 0.75 or length_ratio <= 0.90):
        return True
    if ref_aspect < 2.35 and area_ratio <= 0.34 and width_ratio <= 0.62 and length_ratio <= 0.78:
        return True
    if float(confidence) < 0.16 and area_ratio <= 0.70 and (width_ratio <= 0.72 or length_ratio <= 0.82):
        return True
    return False


def _is_tiny_dimension_fragment(confidence: float, metrics: dict, reference: dict | None, source: str = "") -> bool:
    if reference is None:
        return False
    ref_area = max(float(reference["area"]), 1.0)
    ref_length = max(float(reference["length"]), 1.0)
    ref_width = max(float(reference["width"]), 1.0)
    area_ratio = float(metrics["area_px"]) / ref_area
    length_ratio = float(metrics["length_px"]) / ref_length
    width_ratio = float(metrics["width_px"]) / ref_width
    ref_aspect = ref_length / ref_width

    if ref_aspect < 1.65:
        return bool(area_ratio <= 0.38 and width_ratio <= 0.52 and length_ratio <= 1.15)

    if ref_aspect < 2.25:
        if area_ratio <= 0.18 and (width_ratio <= 0.72 or length_ratio <= 0.92):
            return True
        if area_ratio <= 0.32 and width_ratio <= 0.60 and length_ratio <= 0.76:
            return True
        if _is_tile_edge_source(source) and area_ratio <= 0.38 and (width_ratio <= 0.68 or length_ratio <= 0.82):
            return True
        return False

    # Long crops such as rice have legitimate narrow masks, so only remove
    # very small, low-confidence stubs that are far below the local size model.
    if float(confidence) < 0.14:
        return bool(area_ratio <= 0.18 and length_ratio <= 0.48 and width_ratio <= 0.60)
    return bool(area_ratio <= 0.11 and length_ratio <= 0.38 and width_ratio <= 0.45)


def _is_implausible_reference_seed_candidate(instance: InstanceMask, metrics: dict, reference: dict | None) -> bool:
    if not is_reference_class_instance(instance) or reference is None:
        return False
    ref_area = max(float(reference["area"]), 1.0)
    ref_length = max(float(reference["length"]), 1.0)
    ref_width = max(float(reference["width"]), 1.0)
    area_ratio = float(metrics["area_px"]) / ref_area
    length_ratio = float(metrics["length_px"]) / ref_length
    width_ratio = float(metrics["width_px"]) / ref_width
    ref_aspect = ref_length / ref_width

    if area_ratio < 0.42 or area_ratio > 2.40:
        return True
    if ref_aspect >= 1.65:
        return bool(length_ratio < 0.62 or width_ratio < 0.48)
    return bool(length_ratio < 0.55 or width_ratio < 0.55)


def _bbox_gap(a: dict, b: dict) -> float:
    ax1 = float(a["bbox_x"])
    ay1 = float(a["bbox_y"])
    ax2 = ax1 + float(a["bbox_w"])
    ay2 = ay1 + float(a["bbox_h"])
    bx1 = float(b["bbox_x"])
    by1 = float(b["bbox_y"])
    bx2 = bx1 + float(b["bbox_w"])
    by2 = by1 + float(b["bbox_h"])
    dx = max(bx1 - ax2, ax1 - bx2, 0.0)
    dy = max(by1 - ay2, ay1 - by2, 0.0)
    return float(np.hypot(dx, dy))


def _center_distance(a: dict, b: dict) -> float:
    return float(np.hypot(float(a["centroid_x"]) - float(b["centroid_x"]), float(a["centroid_y"]) - float(b["centroid_y"])))


def _combined_bbox_too_large(a: dict, b: dict, ref_length: float, ref_width: float) -> bool:
    x1 = min(float(a["bbox_x"]), float(b["bbox_x"]))
    y1 = min(float(a["bbox_y"]), float(b["bbox_y"]))
    x2 = max(float(a["bbox_x"]) + float(a["bbox_w"]), float(b["bbox_x"]) + float(b["bbox_w"]))
    y2 = max(float(a["bbox_y"]) + float(a["bbox_h"]), float(b["bbox_y"]) + float(b["bbox_h"]))
    span_x = x2 - x1
    span_y = y2 - y1
    diagonal = float(np.hypot(span_x, span_y))
    return diagonal > max(ref_length * 1.85, ref_width * 3.0)

def _is_adaptive_non_seed_artifact(
    metrics: dict,
    color: dict,
    image_area: int,
    reference: dict | None,
    image_size: tuple[int, int] | None,
) -> bool:
    if reference is None:
        return False
    if _is_partial_border_artifact(metrics, reference, image_size):
        return True
    if _looks_like_reference_marker(metrics, image_area, reference):
        return True
    if _looks_like_neutral_reference_fragment(metrics, color, image_area, reference):
        return True
    return False


def _is_partial_border_artifact(
    metrics: dict,
    reference: dict,
    image_size: tuple[int, int] | None,
) -> bool:
    if image_size is None:
        return False
    width, height = image_size
    area = float(metrics["area_px"])
    if area >= float(reference["area"]) * 0.75:
        return False
    x = int(metrics["bbox_x"])
    y = int(metrics["bbox_y"])
    w = int(metrics["bbox_w"])
    h = int(metrics["bbox_h"])
    return x <= 1 or y <= 1 or x + w >= width - 1 or y + h >= height - 1


def _looks_like_reference_marker(metrics: dict, image_area: int, reference: dict) -> bool:
    area = float(metrics["area_px"])
    length = float(metrics["length_px"])
    width = float(metrics["width_px"])
    aspect = float(metrics["aspect_ratio"])
    solidity = float(metrics["solidity"])
    extent = float(metrics["extent"])
    ref_area = max(float(reference["area"]), 1.0)
    ref_length = max(float(reference["length"]), 1.0)
    ref_width = max(float(reference["width"]), 1.0)
    area_ratio = area / ref_area
    length_ratio = length / ref_length
    width_ratio = width / ref_width
    marker_area_floor = max(float(reference["area_split_upper"]), ref_area * 2.8)
    axes_are_large = (
        area_ratio >= 3.0
        and length_ratio >= 1.35
        and width_ratio >= 1.35
    )
    round_oversize = area_ratio >= 2.8 and aspect <= 1.85 and width_ratio >= 1.65
    round_and_solid = aspect <= 1.75 and solidity >= 0.88 and extent >= 0.45
    not_most_of_image = area / max(image_area, 1) <= 0.12
    return bool(area >= marker_area_floor and (axes_are_large or round_oversize) and round_and_solid and not_most_of_image)


def _looks_like_neutral_reference_fragment(metrics: dict, color: dict, image_area: int, reference: dict) -> bool:
    area = float(metrics["area_px"])
    length = float(metrics["length_px"])
    width = float(metrics["width_px"])
    aspect = float(metrics["aspect_ratio"])
    solidity = float(metrics["solidity"])
    extent = float(metrics["extent"])
    ref_area = max(float(reference["area"]), 1.0)
    ref_length = max(float(reference["length"]), 1.0)
    ref_width = max(float(reference["width"]), 1.0)
    area_ratio = area / ref_area
    length_ratio = length / ref_length
    width_ratio = width / ref_width
    neutral_ratio = float(color.get("neutral_ratio", 0.0) or 0.0)
    chroma = float(color.get("chroma", 255.0) or 255.0)
    luma = float(color.get("luma", 0.0) or 0.0)

    if area / max(image_area, 1) > 0.12:
        return False
    if area_ratio < 3.2:
        return False
    if solidity < 0.82 or extent < 0.48:
        return False
    neutral_surface = neutral_ratio >= 0.72 or chroma <= 24.0
    bright_or_metal = luma >= 135.0 or neutral_ratio >= 0.92
    if not (neutral_surface and bright_or_metal):
        return False

    broad_fragment = length_ratio >= 1.75 and width_ratio >= 1.55 and aspect <= 4.2
    round_fragment = width_ratio >= 1.85 and aspect <= 1.55
    return bool(broad_fragment or round_fragment)


def _looks_like_seed_shadow(metrics: dict, color: dict, reference: dict | None) -> bool:
    if reference is None:
        return False
    reference_chroma = float(reference.get("chroma", 0.0) or 0.0)
    reference_neutral = float(reference.get("neutral_ratio", 1.0) or 1.0)
    reference_luma = float(reference.get("luma", 0.0) or 0.0)
    # Do not color-filter pale/neutral crops such as rice on a dark board.
    if reference_chroma < 24.0 and reference_neutral > 0.70:
        return False

    area = float(metrics["area_px"])
    area_ratio = area / max(float(reference["area"]), 1.0)
    if area_ratio < 0.12 or area_ratio > 2.6:
        return False

    chroma = float(color.get("chroma", 255.0) or 255.0)
    neutral_ratio = float(color.get("neutral_ratio", 0.0) or 0.0)
    luma = float(color.get("luma", 0.0) or 0.0)
    low_color = neutral_ratio >= 0.86 and chroma <= max(18.0, reference_chroma * 0.46)
    brighter_than_seed = luma >= reference_luma + 24.0
    very_neutral = neutral_ratio >= 0.96 and chroma <= 14.0
    return bool(low_color and (brighter_than_seed or very_neutral))


def _looks_like_dark_background_artifact(
    confidence: float,
    metrics: dict,
    color: dict,
    reference: dict | None,
) -> bool:
    if reference is None:
        return False
    reference_luma = float(reference.get("luma", 0.0) or 0.0)
    reference_chroma = float(reference.get("chroma", 0.0) or 0.0)
    if reference_luma < 145.0:
        return False

    area_ratio = float(metrics["area_px"]) / max(float(reference["area"]), 1.0)
    if area_ratio < 0.10 or area_ratio > 2.6:
        return False

    luma = float(color.get("luma", 0.0) or 0.0)
    chroma = float(color.get("chroma", 0.0) or 0.0)
    skin_ratio = float(color.get("skin_ratio", 0.0) or 0.0)
    neutral_ratio = float(color.get("neutral_ratio", 0.0) or 0.0)
    much_darker = luma <= reference_luma - max(42.0, reference_luma * 0.24)
    wood_like = skin_ratio >= 0.72 and chroma >= max(40.0, reference_chroma * 0.48) and neutral_ratio <= 0.28
    low_conf_dark = float(confidence) < 0.12 and luma <= reference_luma - 75.0 and neutral_ratio <= 0.45
    return bool(much_darker and (wood_like or low_conf_dark))


def _suggested_reference_line(
    candidates: list[tuple[InstanceMask, dict, dict]],
    image_area: int,
    reference: dict | None,
    image_size: tuple[int, int],
    scale: float,
) -> dict | None:
    if reference is None:
        return None
    width, height = image_size
    marker_candidates = [
        candidate
        for candidate in candidates
        if not _is_partial_border_artifact(candidate[1], reference, image_size)
        and _looks_like_reference_marker(candidate[1], image_area, reference)
        and _is_suggestable_reference_marker(candidate, image_area)
    ]
    if not marker_candidates:
        return None
    marker_candidates.sort(key=_reference_marker_priority, reverse=True)
    instance, metrics, _ = marker_candidates[0]
    return _reference_line_from_mask(instance, metrics, width, height, scale)


def _reference_marker_priority(candidate: tuple[InstanceMask, dict, dict]) -> float:
    instance, metrics, _ = candidate
    area = max(float(metrics.get("area_px", 1) or 1), 1.0)
    ref_bonus = 1.0 if is_reference_class_instance(instance) else 0.0
    return ref_bonus + float(instance.confidence) + float(np.log(area)) / 20.0


def _is_suggestable_reference_marker(candidate: tuple[InstanceMask, dict, dict], image_area: int) -> bool:
    instance, metrics, color = candidate
    if is_reference_class_instance(instance):
        return True
    area = float(metrics.get("area_px", 0) or 0)
    luma = float(color.get("luma", 0.0) or 0.0)
    neutral_ratio = float(color.get("neutral_ratio", 0.0) or 0.0)
    if area / max(image_area, 1) > 0.08:
        return False
    if neutral_ratio >= 0.85 and luma >= 225.0:
        return False
    return True


def _reference_line_from_mask(instance: InstanceMask, metrics: dict, width: int, height: int, scale: float) -> dict | None:
    ys, xs = np.nonzero(instance.mask)
    if len(xs) < 2:
        return None
    center = np.array(
        [float(metrics["centroid_x"]), float(metrics["centroid_y"])],
        dtype=np.float64,
    )
    points = np.column_stack([xs.astype(np.float64), ys.astype(np.float64)])
    centered = points - center
    try:
        cov = np.cov(centered, rowvar=False)
        values, vectors = np.linalg.eigh(cov)
        axis = vectors[:, int(np.argmax(values))]
    except np.linalg.LinAlgError:
        axis = np.array([1.0, 0.0], dtype=np.float64)
    norm = float(np.linalg.norm(axis))
    if norm <= 1e-9:
        axis = np.array([1.0, 0.0], dtype=np.float64)
    else:
        axis = axis / norm
    half_length = max(float(metrics["length_px"]), 2.0) / 2.0
    start = center - axis * half_length
    end = center + axis * half_length
    start[0] = np.clip(start[0], 0, max(width - 1, 0))
    start[1] = np.clip(start[1], 0, max(height - 1, 0))
    end[0] = np.clip(end[0], 0, max(width - 1, 0))
    end[1] = np.clip(end[1], 0, max(height - 1, 0))
    processed_pixels = float(np.hypot(end[0] - start[0], end[1] - start[1]))
    if processed_pixels <= 1.0:
        return None
    safe_scale = max(float(scale), 1e-6)
    original_start = start / safe_scale
    original_end = end / safe_scale
    return {
        "available": True,
        "source": "detected_ref",
        "pixel_space": "original",
        "x1": round(float(original_start[0]), 3),
        "y1": round(float(original_start[1]), 3),
        "x2": round(float(original_end[0]), 3),
        "y2": round(float(original_end[1]), 3),
        "pixels": round(processed_pixels / safe_scale, 3),
        "processed": {
            "x1": round(float(start[0]), 3),
            "y1": round(float(start[1]), 3),
            "x2": round(float(end[0]), 3),
            "y2": round(float(end[1]), 3),
            "pixels": round(processed_pixels, 3),
        },
        "confidence": round(float(instance.confidence), 6),
        "class_id": 1,
        "class_name": "Ref",
        "detected_class_id": int(instance.class_id),
        "detected_class_name": str(instance.class_name),
    }


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


def _could_be_reference_marker_without_size(metrics: dict, image_area: int) -> bool:
    area = float(metrics["area_px"])
    aspect = float(metrics["aspect_ratio"])
    solidity = float(metrics["solidity"])
    extent = float(metrics["extent"])
    if area / max(image_area, 1) > 0.12:
        return False
    return bool(area >= max(1200.0, image_area * 0.008) and aspect <= 1.9 and solidity >= 0.86 and extent >= 0.44)


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


def _is_low_confidence_reference_fragment(confidence: float, metrics: dict, reference: dict | None) -> bool:
    if reference is None or confidence >= 0.24:
        return False
    area = float(metrics["area_px"])
    length = float(metrics["length_px"])
    width = float(metrics["width_px"])
    aspect = float(metrics["aspect_ratio"])
    ref_area = max(float(reference["area"]), 1.0)
    ref_length = max(float(reference["length"]), 1.0)
    ref_width = max(float(reference["width"]), 1.0)
    if ref_length / ref_width < 1.45:
        return False
    area_large = area >= ref_area * 1.32
    axes_large = length >= ref_length * 1.22 and width >= ref_width * 1.18
    round_oversize = aspect <= 1.38 and width >= ref_width * 1.22
    return bool(area_large and (axes_large or round_oversize))


def _size_reference_for(
    candidates: list[tuple[InstanceMask, dict, dict]],
    params: dict,
    *,
    min_candidates: int | None = None,
) -> dict | None:
    if not bool_param(params, "enableAdaptiveThresholds"):
        return None
    candidate_floor = int_param(params, "adaptiveMinCandidates") if min_candidates is None else max(3, int(min_candidates))
    if len(candidates) < candidate_floor:
        return None
    seed_candidates = [candidate for candidate in candidates if is_seed_instance(candidate[0])]
    reference_source = seed_candidates if len(seed_candidates) >= candidate_floor else candidates
    reference_candidates = [
        candidate
        for candidate in reference_source
        if float(candidate[2].get("skin_ratio", 0.0) or 0.0) < 0.35
    ]
    if len(reference_candidates) < candidate_floor:
        reference_candidates = reference_source
    areas = [float(candidate[1]["area_px"]) for candidate in reference_candidates]
    lengths = [float(candidate[1]["length_px"]) for candidate in reference_candidates]
    widths = [float(candidate[1]["width_px"]) for candidate in reference_candidates]
    aspects = [float(candidate[1]["aspect_ratio"]) for candidate in reference_candidates]
    color_candidates = candidates if len(candidates) >= candidate_floor else reference_candidates
    chromas = [float(candidate[2].get("chroma", 0.0) or 0.0) for candidate in color_candidates]
    neutral_ratios = [float(candidate[2].get("neutral_ratio", 0.0) or 0.0) for candidate in color_candidates]
    lumas = [float(candidate[2].get("luma", 0.0) or 0.0) for candidate in color_candidates]
    area_median = float(np.median(areas))
    length_median = float(np.median(lengths))
    width_median = float(np.median(widths))
    aspect_median = float(np.median(aspects))
    chroma_median = float(np.median(chromas))
    neutral_ratio_median = float(np.median(neutral_ratios))
    luma_median = float(np.median(lumas))
    area_mad_ratio = _mad_ratio(areas, area_median)
    length_mad_ratio = _mad_ratio(lengths, length_median)
    width_mad_ratio = _mad_ratio(widths, width_median)
    split_z = float_param(params, "mergedSplitMadZ")
    return {
        "area": area_median,
        "length": length_median,
        "width": width_median,
        "chroma": chroma_median,
        "neutral_ratio": neutral_ratio_median,
        "luma": luma_median,
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


def _merge_fragment_candidates(
    candidates: list[tuple[InstanceMask, dict, dict]],
    params: dict,
    reference: dict | None,
    rgb: np.ndarray | None,
    image_area: int,
    image_size: tuple[int, int],
) -> tuple[list[tuple[InstanceMask, dict, dict]], int]:
    if not bool_param(params, "enableFragmentMerge", True) or reference is None or len(candidates) < 2:
        return candidates, 0

    pending = list(candidates)
    merge_count = 0
    max_merges = max(1, len(pending) // 2)
    for _ in range(max_merges):
        best: tuple[float, int, int, tuple[InstanceMask, dict, dict]] | None = None
        for i in range(len(pending) - 1):
            for j in range(i + 1, len(pending)):
                candidate = _fragment_merge_candidate(
                    pending[i],
                    pending[j],
                    params,
                    reference,
                    rgb,
                    image_area,
                    image_size,
                )
                if candidate is None:
                    continue
                score, merged = candidate
                if best is None or score < best[0]:
                    best = (score, i, j, merged)
        if best is None:
            break
        _, i, j, merged = best
        pending = [item for index, item in enumerate(pending) if index not in {i, j}]
        pending.append(merged)
        merge_count += 1
    return pending, merge_count


def _fragment_merge_candidate(
    a: tuple[InstanceMask, dict, dict],
    b: tuple[InstanceMask, dict, dict],
    params: dict,
    reference: dict,
    rgb: np.ndarray | None,
    image_area: int,
    image_size: tuple[int, int],
) -> tuple[float, tuple[InstanceMask, dict, dict]] | None:
    a_instance, a_metrics, a_color = a
    b_instance, b_metrics, b_color = b
    ref_area = max(float(reference["area"]), 1.0)
    ref_length = max(float(reference["length"]), 1.0)
    ref_width = max(float(reference["width"]), 1.0)
    ref_aspect = ref_length / ref_width

    gap = _bbox_gap(a_metrics, b_metrics)
    max_gap = max(2.0, ref_width * float_param(params, "fragmentMergeMaxGapRatio", 0.08, 0.0, 2.0))
    if gap > max_gap:
        return None

    center_distance = _center_distance(a_metrics, b_metrics)
    if center_distance > max(ref_length * 0.78, ref_width * 1.80):
        return None
    if _combined_bbox_too_large(a_metrics, b_metrics, ref_length, ref_width):
        return None

    a_area_ratio = float(a_metrics["area_px"]) / ref_area
    b_area_ratio = float(b_metrics["area_px"]) / ref_area
    a_length_ratio = float(a_metrics["length_px"]) / ref_length
    b_length_ratio = float(b_metrics["length_px"]) / ref_length
    a_width_ratio = float(a_metrics["width_px"]) / ref_width
    b_width_ratio = float(b_metrics["width_px"]) / ref_width
    partial_a = a_area_ratio <= 0.68 or a_length_ratio <= 0.74 or a_width_ratio <= 0.68 or float(a_instance.confidence) < 0.12
    partial_b = b_area_ratio <= 0.68 or b_length_ratio <= 0.74 or b_width_ratio <= 0.68 or float(b_instance.confidence) < 0.12
    if not (partial_a and partial_b):
        return None
    width_half_pattern = (
        a_width_ratio <= 0.74
        and b_width_ratio <= 0.74
        and max(a_length_ratio, b_length_ratio) <= 1.16
    )
    length_half_pattern = (
        a_length_ratio <= 0.74
        and b_length_ratio <= 0.74
        and max(a_width_ratio, b_width_ratio) <= 1.16
    )
    compact_half_pattern = (
        a_area_ratio <= 0.58
        and b_area_ratio <= 0.58
        and max(a_length_ratio, b_length_ratio) <= 1.05
        and max(a_width_ratio, b_width_ratio) <= 1.05
    )
    if not (width_half_pattern or length_half_pattern or compact_half_pattern):
        return None
    if a_area_ratio + b_area_ratio > float_param(params, "fragmentMergeMaxAreaRatio", 1.28, 1.0, 3.0):
        return None
    if max(a_area_ratio, b_area_ratio) > 1.08 and min(a_area_ratio, b_area_ratio) > 0.38:
        return None

    if ref_aspect >= 1.65:
        axis_similarity = abs(float(np.dot(_axis_vector(a_metrics), _axis_vector(b_metrics))))
        if axis_similarity < 0.72:
            return None

    merged_mask = np.logical_or(a_instance.mask, b_instance.mask)
    merged_bbox = _bbox_from_mask(merged_mask)
    if merged_bbox is None:
        return None
    merged_metrics = _union_mask_metrics(merged_mask, merged_bbox)
    if merged_metrics is None:
        return None
    merged_color = mask_color_metrics(rgb, merged_mask, merged_metrics)

    merged_area_ratio = float(merged_metrics["area_px"]) / ref_area
    merged_length_ratio = float(merged_metrics["length_px"]) / ref_length
    merged_width_ratio = float(merged_metrics["width_px"]) / ref_width
    min_area_ratio = float_param(params, "fragmentMergeMinAreaRatio", 0.65, 0.0, 1.0)
    max_area_ratio = float_param(params, "fragmentMergeMaxAreaRatio", 1.28, 1.0, 3.0)
    if merged_area_ratio < min_area_ratio or merged_area_ratio > max_area_ratio:
        return None
    if merged_length_ratio > float_param(params, "fragmentMergeMaxLengthRatio", 1.20, 1.0, 3.0):
        return None
    if merged_width_ratio > float_param(params, "fragmentMergeMaxWidthRatio", 1.22, 1.0, 3.0):
        return None
    if merged_length_ratio < 0.52 or merged_width_ratio < 0.42:
        return None
    merged_aspect = float(merged_metrics["aspect_ratio"])
    if ref_aspect >= 1.65:
        if merged_aspect < max(1.18, ref_aspect * 0.48) or merged_aspect > ref_aspect * 1.75:
            return None
    elif merged_aspect > 2.35:
        return None

    if not _passes_candidate_filter(
        max(float(a_instance.confidence), float(b_instance.confidence)),
        merged_metrics,
        merged_color,
        image_area,
        params,
        reference,
        image_size,
        source="fragment_merge",
    ):
        return None

    expected_score = (
        abs(merged_area_ratio - 1.0)
        + abs(merged_length_ratio - 1.0) * 0.65
        + abs(merged_width_ratio - 1.0) * 0.65
        + gap / max(ref_width, 1.0) * 0.45
    )
    merged_instance = InstanceMask(
        mask=merged_mask,
        confidence=max(float(a_instance.confidence), float(b_instance.confidence)) * 0.995,
        class_id=0,
        class_name="seed",
        source="fragment_merge",
        bbox=merged_bbox,
    )
    return expected_score, (merged_instance, merged_metrics, merged_color)


def _axis_vector(metrics: dict) -> np.ndarray:
    angle = np.deg2rad(float(metrics.get("angle_deg", 0.0) or 0.0))
    return np.asarray([np.cos(angle), np.sin(angle)], dtype=np.float64)


def _union_mask_metrics(mask: np.ndarray, bbox: tuple[int, int, int, int] | None = None) -> dict | None:
    metrics = mask_metrics(mask, bbox)
    if metrics is None:
        return None
    x = max(0, int(metrics["bbox_x"]))
    y = max(0, int(metrics["bbox_y"]))
    w = max(0, int(metrics["bbox_w"]))
    h = max(0, int(metrics["bbox_h"]))
    if w <= 0 or h <= 0:
        return None
    crop = mask[y : y + h, x : x + w].astype(bool, copy=False)
    ys, xs = np.nonzero(crop)
    if xs.size == 0:
        return None
    points = _contour_points(crop.astype(np.uint8, copy=False))
    if points is None:
        return None
    width_points = np.column_stack([xs.astype(np.float64), ys.astype(np.float64)])
    length, width, angle, hull_area = _feret_shape_metrics(points, width_points)
    area = int(xs.size)
    return {
        **metrics,
        "length_px": round(length, 3),
        "width_px": round(width, 3),
        "angle_deg": round(angle, 3),
        "solidity": round(min(float(area / hull_area), 1.0), 6),
        "extent": round(float(area / max(w * h, 1)), 6),
        "aspect_ratio": round(float(length / width), 6),
        "measurement_method": MEASUREMENT_METHOD,
    }


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
            part_metrics = mask_metrics(part.mask, part.bbox)
            if part_metrics is None:
                continue
            split_candidates.append((part, part_metrics, mask_color_metrics(rgb, part.mask, part_metrics)))
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
            part_metrics = mask_metrics(part.mask, part.bbox)
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
                    bbox=_bbox_from_mask(split_mask),
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


def is_reference_class_instance(instance: InstanceMask) -> bool:
    return instance.class_id in REFERENCE_CLASS_IDS or str(instance.class_name).strip().lower() in REFERENCE_CLASS_NAMES


def is_measurement_candidate_instance(instance: InstanceMask) -> bool:
    return is_seed_instance(instance) or is_reference_class_instance(instance)


def _contour_points(mask: np.ndarray) -> np.ndarray | None:
    contours, _ = cv2.findContours(mask.astype(np.uint8, copy=False), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    points = [contour.reshape(-1, 2) for contour in contours if contour.size]
    if not points:
        return None
    return np.vstack(points).astype(np.float64, copy=False)


MEASUREMENT_METHOD = "smartgrain_feret_chord"
WIDTH_CHORD_PERCENTILE = 80.0


def _perpendicular_chord_width(points: np.ndarray, axis: np.ndarray) -> float:
    if points.shape[0] < 2:
        return 1.0

    normal = np.asarray([-axis[1], axis[0]], dtype=np.float64)
    axis_projection = points @ axis
    normal_projection = points @ normal
    axis_min = float(axis_projection.min())
    bins = np.floor((axis_projection - axis_min) + 0.5).astype(np.int64, copy=False)
    order = np.argsort(bins, kind="mergesort")
    sorted_bins = bins[order]
    sorted_normal = normal_projection[order]
    chord_widths: list[float] = []

    start = 0
    while start < sorted_bins.size:
        end = start + 1
        while end < sorted_bins.size and sorted_bins[end] == sorted_bins[start]:
            end += 1
        if end - start >= 2:
            group = sorted_normal[start:end]
            chord_widths.append(float(group.max() - group.min()))
        start = end

    if not chord_widths:
        return 1.0
    return max(float(np.percentile(chord_widths, WIDTH_CHORD_PERCENTILE)), 1.0)


def _feret_shape_metrics(points: np.ndarray, width_points: np.ndarray | None = None) -> tuple[float, float, float, float]:
    if points.shape[0] < 2:
        return 1.0, 1.0, 0.0, 1.0

    hull = cv2.convexHull(points.astype(np.float32, copy=False)).reshape(-1, 2).astype(np.float64, copy=False)
    hull_area = max(float(cv2.contourArea(hull.astype(np.float32, copy=False).reshape(-1, 1, 2))), 1.0)
    if hull.shape[0] < 2:
        return 1.0, 1.0, 0.0, hull_area

    deltas = hull[:, None, :] - hull[None, :, :]
    distances_squared = np.einsum("ijk,ijk->ij", deltas, deltas)
    start_index, end_index = np.unravel_index(int(np.argmax(distances_squared)), distances_squared.shape)
    start = hull[start_index]
    end = hull[end_index]
    axis = end - start
    length = max(float(np.linalg.norm(axis)), 1.0)
    if length <= 1e-9:
        return 1.0, 1.0, 0.0, hull_area

    axis = axis / length
    width = _perpendicular_chord_width(width_points if width_points is not None else points, axis)
    angle = float(np.degrees(np.arctan2(axis[1], axis[0])))
    return length, width, angle, hull_area


def mask_metrics(mask: np.ndarray, bbox: tuple[int, int, int, int] | None = None) -> dict | None:
    mask_bool = mask.astype(bool, copy=False)
    height, width = mask_bool.shape[:2]
    offset_x = 0
    offset_y = 0
    crop_source = mask_bool
    if bbox is not None:
        x, y, w, h = bbox
        x1 = max(0, min(width, int(x)))
        y1 = max(0, min(height, int(y)))
        x2 = min(width, x1 + max(0, int(w)))
        y2 = min(height, y1 + max(0, int(h)))
        if x2 > x1 and y2 > y1:
            crop_source = mask_bool[y1:y2, x1:x2]
            offset_x = x1
            offset_y = y1
    ys, xs = np.nonzero(crop_source)
    if xs.size == 0 and bbox is not None:
        return mask_metrics(mask, None)
    area = int(xs.size)
    if area <= 0:
        return None
    x = int(xs.min()) + offset_x
    y = int(ys.min()) + offset_y
    x2 = int(xs.max()) + 1 + offset_x
    y2 = int(ys.max()) + 1 + offset_y
    w = x2 - x
    h = y2 - y
    crop = mask_bool[y:y2, x:x2].astype(np.uint8, copy=False)
    points = _contour_points(crop)
    if points is None:
        return None
    crop_ys, crop_xs = np.nonzero(crop)
    width_points = np.column_stack([crop_xs.astype(np.float64), crop_ys.astype(np.float64)])
    length, width, angle, hull_area = _feret_shape_metrics(points, width_points)
    solidity = min(float(area / hull_area), 1.0)
    return {
        "area_px": area,
        "length_px": round(length, 3),
        "width_px": round(width, 3),
        "centroid_x": round(float(xs.mean() + offset_x), 3),
        "centroid_y": round(float(ys.mean() + offset_y), 3),
        "bbox_x": int(x),
        "bbox_y": int(y),
        "bbox_w": int(w),
        "bbox_h": int(h),
        "angle_deg": round(angle, 3),
        "solidity": round(solidity, 6),
        "extent": round(float(area / max(w * h, 1)), 6),
        "aspect_ratio": round(float(length / width), 6),
        "measurement_method": MEASUREMENT_METHOD,
    }


def _bbox_from_mask(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    x1 = int(xs.min())
    y1 = int(ys.min())
    x2 = int(xs.max()) + 1
    y2 = int(ys.max()) + 1
    return x1, y1, x2 - x1, y2 - y1


def _measurement_quality_flags(metrics: dict, instance: InstanceMask, image_size: tuple[int, int]) -> str:
    flags: list[str] = []
    if is_reference_class_instance(instance):
        flags.append("model_label_ref_as_seed")
    if float(instance.confidence) < 0.16:
        flags.append("low_confidence")
    aspect = float(metrics.get("aspect_ratio", 1.0) or 1.0)
    min_extent = 0.24 if aspect >= 3.2 else (0.28 if aspect >= 2.2 else 0.35)
    if float(metrics.get("solidity", 1.0) or 1.0) < 0.72 or float(metrics.get("extent", 1.0) or 1.0) < min_extent:
        flags.append("loose_mask")
    if (
        _is_tile_edge_source(instance.source)
        and float(instance.confidence) < 0.16
        and float(metrics.get("extent", 1.0) or 1.0) < 0.45
    ):
        flags.append("partial_tile_mask")
    if aspect > 8.0:
        flags.append("extreme_aspect")
    width, height = image_size
    x = int(metrics.get("bbox_x", 0) or 0)
    y = int(metrics.get("bbox_y", 0) or 0)
    w = int(metrics.get("bbox_w", 0) or 0)
    h = int(metrics.get("bbox_h", 0) or 0)
    if x <= 1 or y <= 1 or x + w >= width - 1 or y + h >= height - 1:
        flags.append("touches_image_edge")
    return ",".join(flags)


def mask_color_metrics(rgb: np.ndarray | None, mask: np.ndarray, metrics: dict | None = None) -> dict:
    if rgb is None or rgb.shape[:2] != mask.shape[:2]:
        return {"skin_ratio": 0.0, "luma": 0.0, "chroma": 0.0, "neutral_ratio": 0.0}
    if metrics is not None:
        x = max(0, int(metrics.get("bbox_x", 0) or 0))
        y = max(0, int(metrics.get("bbox_y", 0) or 0))
        w = max(0, int(metrics.get("bbox_w", 0) or 0))
        h = max(0, int(metrics.get("bbox_h", 0) or 0))
        if w <= 0 or h <= 0:
            return {"skin_ratio": 0.0, "luma": 0.0, "chroma": 0.0, "neutral_ratio": 0.0}
        x2 = min(rgb.shape[1], x + w)
        y2 = min(rgb.shape[0], y + h)
        selected = rgb[y:y2, x:x2][mask[y:y2, x:x2].astype(bool, copy=False)]
    else:
        selected = rgb[mask.astype(bool, copy=False)]
    if selected.size == 0:
        return {"skin_ratio": 0.0, "luma": 0.0, "chroma": 0.0, "neutral_ratio": 0.0}
    pixels = selected.astype(np.float32)
    r = pixels[:, 0]
    g = pixels[:, 1]
    b = pixels[:, 2]
    luma = 0.299 * r + 0.587 * g + 0.114 * b
    max_channel = np.maximum.reduce([r, g, b])
    min_channel = np.minimum.reduce([r, g, b])
    chroma = max_channel - min_channel
    cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b
    cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b
    rgb_rule = (r > 70) & (g > 35) & (b > 20) & (r > g) & (r > b) & ((max_channel - min_channel) > 15)
    ycbcr_rule = (cr >= 135) & (cr <= 185) & (cb >= 75) & (cb <= 140)
    skin = rgb_rule & ycbcr_rule
    return {
        "skin_ratio": float(np.count_nonzero(skin) / max(len(pixels), 1)),
        "luma": float(np.mean(luma)),
        "chroma": float(np.mean(chroma)),
        "neutral_ratio": float(np.count_nonzero(chroma < 28.0) / max(len(pixels), 1)),
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
            "quality": _quality_summary([]),
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
        "quality": _quality_summary(measurements),
    }


def _quality_summary(measurements: list[dict]) -> dict:
    flag_counts: dict[str, int] = {}
    problem_flags = {"loose_mask", "touches_image_edge", "extreme_aspect", "partial_tile_mask"}
    problem_count = 0
    for measurement in measurements:
        measurement_flags = {
            flag.strip()
            for flag in str(measurement.get("quality_flags") or "").split(",")
            if flag.strip()
        }
        if measurement_flags.intersection(problem_flags):
            problem_count += 1
        for flag in measurement_flags:
            flag_counts[flag] = flag_counts.get(flag, 0) + 1
    count = len(measurements)
    label_confusion_count = flag_counts.get("model_label_ref_as_seed", 0)
    return {
        "flag_counts": flag_counts,
        "problem_count": int(problem_count),
        "problem_ratio": round(problem_count / count, 6) if count else 0,
        "label_confusion_count": int(label_confusion_count),
        "label_confusion_ratio": round(label_confusion_count / count, 6) if count else 0,
        "review_required": bool(problem_count),
        "status": "review_required" if problem_count else "ok",
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
