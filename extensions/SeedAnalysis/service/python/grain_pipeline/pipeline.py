from __future__ import annotations

from pathlib import Path

import numpy as np

from .classical_fallback import augment_low_recall_instances
from .config import PIPELINE_NAME, bool_param, float_param, int_param, model_path
from .io import png_base64, read_image
from .mask_refine import refine_instances_post
from .measure import calibration_factor, filter_and_measure, is_seed_instance, measurements_csv, summary_for
from .preprocess import apply_light_preprocessing
from .reference_marker import recover_reference_marker, reference_suggestion
from .render import instance_mask_rgb, label_map_rgb, label_rgb, mask_rgb, overlay_rgb
from .yolo_segment import predict_instances


def analyze_image(image_path: Path, params: dict) -> dict:
    # ── Stage 0: load & preprocess ──────────────────────────────────────────
    max_side = int_param(params, "maxSide")
    prepared = read_image(image_path, max_side)
    segment_input = apply_light_preprocessing(prepared.rgb, params)

    # ── Stage 1: YOLO-seg ONNX inference ────────────────────────────────────
    yolo_instances = predict_instances(segment_input, params)
    yolo_instances, classical_fallback_stats = augment_low_recall_instances(segment_input, yolo_instances, params)

    # ── Stage 2: optional CPU mask refinement ──────────────────────────────
    instances = yolo_instances

    # ── Stage 3: GrabCut, edge-snap, boundary refine, and split heuristics ──
    instances = refine_instances_post(segment_input, instances, params)
    instances, reference_recovery_stats = recover_reference_marker(segment_input, instances, params)

    # ── Stage 4: filter & measure ────────────────────────────────────────────
    labels, measurements, excluded_reference_object_count, filter_stats = filter_and_measure(
        instances,
        params,
        prepared.scale,
        segment_input,
    )
    seed_candidate_count = sum(1 for item in instances if is_seed_instance(item))
    ref_candidate_count = len(instances) - seed_candidate_count
    suggested_reference = filter_stats.get("suggested_reference") or reference_suggestion(
        reference_recovery_stats,
        prepared.scale,
    )

    if labels.shape[:2] != segment_input.shape[:2]:
        labels = np.zeros(segment_input.shape[:2], dtype=np.int32)

    summary       = summary_for(measurements)
    overlay       = overlay_rgb(segment_input, labels, measurements)
    labels_image  = label_rgb(labels, measurements)
    mask_image    = mask_rgb(labels, measurements)
    label_map     = label_map_rgb(labels)
    instance_mask_image = instance_mask_rgb(instances)
    mask_pixels   = int(np.count_nonzero(labels))
    mm_per_pixel  = calibration_factor(params, prepared.scale)

    return {
        "image": {
            "width":           int(segment_input.shape[1]),
            "height":          int(segment_input.shape[0]),
            "original_width":  int(prepared.original_width),
            "original_height": int(prepared.original_height),
            "scale":           round(float(prepared.scale), 6),
        },
        "features": {
            "pipeline": PIPELINE_NAME,
            "preprocess": {
                "enabled":             bool_param(params, "preprocessImage"),
                "whiteBalanceStrength": float_param(params, "whiteBalanceStrength"),
                "claheClipLimit":       float_param(params, "claheClipLimit"),
                "denoiseStrength":      float_param(params, "denoiseStrength"),
            },
        },
        "segmentation": {
            "pipeline":                "yolo_onnx",
            "execution":               "server_onnxruntime",
            "model":                   model_path(params),
            "refiner":                 "disabled",
            "refiner_applied":         False,
            "refiner_skip_reason":     "",
            "cpu_refine": {
                "grabcut_enabled":  bool_param(params, "enableGrabCut"),
                "grabcut_iter":     int_param(params, "grabCutIter"),
                "edge_snap_enabled": bool_param(params, "enableEdgeSnap"),
                "edge_snap_radius": int_param(params, "edgeSnapRadius"),
                "contour_smooth":   float_param(params, "maskContourSmooth"),
                "boundary_refine_enabled": bool_param(params, "enableBoundaryRefine"),
                "boundary_refine_padding": int_param(params, "boundaryRefinePadding"),
                "boundary_refine_radius": int_param(params, "boundaryRefineRadius"),
                "boundary_refine_max_area_change": float_param(params, "boundaryRefineMaxAreaChange"),
                "morph_split_enabled": bool_param(params, "enableMorphSplit"),
                "morph_split_min_area": int_param(params, "morphSplitMinArea"),
                "morph_split_kernel": int_param(params, "morphSplitKernel"),
                "morph_split_max_components": int_param(params, "morphSplitMaxComponents"),
                "morph_split_min_component_area_ratio": float_param(params, "morphSplitMinComponentAreaRatio"),
                "skin_reject_enabled": bool_param(params, "enableSkinReject"),
                "skin_reject_ratio": float_param(params, "skinRejectRatio"),
                "strong_skin_reject_ratio": float_param(params, "strongSkinRejectRatio"),
                "adaptive_thresholds_enabled": bool_param(params, "enableAdaptiveThresholds"),
                "adaptive_min_candidates": int_param(params, "adaptiveMinCandidates"),
                "adaptive_mad_z": float_param(params, "adaptiveMadZ"),
                "dynamic_area_multiplier": float_param(params, "dynamicAreaMultiplier"),
                "merged_seed_split_enabled": bool_param(params, "enableMergedSeedSplit"),
                "merged_split_area_ratio": float_param(params, "mergedSplitAreaRatio"),
                "merged_split_length_ratio": float_param(params, "mergedSplitLengthRatio"),
                "merged_split_width_ratio": float_param(params, "mergedSplitWidthRatio"),
                "merged_split_mad_z": float_param(params, "mergedSplitMadZ"),
                "merged_split_max_parts": int_param(params, "mergedSplitMaxParts"),
                "merged_split_method": "distance_marker_projection",
                "merged_split_evidence_gate": "distance_core_or_low_extent",
            },
            "confidence":              float_param(params, "yoloConf"),
            "iou":                     float_param(params, "yoloIou"),
            "max_det":                 int_param(params, "yoloMaxDet"),
            "mask_threshold":          float_param(params, "maskThreshold"),
            "long_mask_threshold":     float_param(params, "longMaskThreshold"),
            "long_mask_aspect_ratio":  float_param(params, "longMaskAspectRatio"),
            "mask_crop_padding_ratio": float_param(params, "maskCropPaddingRatio"),
            "long_mask_crop_padding_ratio": float_param(params, "longMaskCropPaddingRatio"),
            "tiled_inference":         bool_param(params, "enableTiledInference"),
            "full_image_pass":         bool_param(params, "enableFullImagePass"),
            "tile_size":               int_param(params, "tileSize"),
            "tile_overlap":            float_param(params, "tileOverlap"),
            "tiny_tile_pass":          bool_param(params, "enableTinyTilePass"),
            "tiny_tile_size":          int_param(params, "tinyTileSize"),
            "merge_iou":               float_param(params, "mergeIou"),
            "merge_overlap":           float_param(params, "mergeOverlap"),
            "edge_margin_ratio":       float_param(params, "edgeMarginRatio"),
            "merged_split_method":      "distance_marker_projection",
            "merged_split_evidence_gate": "distance_core_or_low_extent",
            "candidate_count":         len(yolo_instances),
            "refined_candidate_count": len(instances),
            "seed_candidate_count":    seed_candidate_count,
            "ref_candidate_count":     ref_candidate_count,
            "segment_count_before_filter": len(instances),
            "segment_count":           len(measurements),
            "marker_count":            len(measurements),
            "raw_mask_pixels":         int(sum(int(np.count_nonzero(item.mask)) for item in instances)),
            "mask_pixels":             mask_pixels,
            "mask_filter": {
                "component_count_before": len(instances),
                "component_count_after":  len(measurements),
                "ignored_ref_count":      max(
                    0,
                    ref_candidate_count - int(filter_stats.get("accepted_ref_class_seed_count", 0)),
                ),
                "excluded_reference_object_count": excluded_reference_object_count,
                "accepted_ref_class_seed_count": int(filter_stats.get("accepted_ref_class_seed_count", 0)),
                "auto_excluded_non_seed_count": int(filter_stats.get("auto_excluded_non_seed_count", 0)),
                "fragment_merge_count": int(filter_stats.get("fragment_merge_count", 0)),
                "suggested_reference_available": bool(suggested_reference),
            },
            "classical_fallback":       classical_fallback_stats,
            "reference_recovery":       reference_recovery_stats,
            "effective_thresholds": {
                "minArea":                int_param(params, "minArea"),
                "maxArea":                int_param(params, "maxArea"),
                "maxSegmentAspectRatio":  float_param(params, "maxSegmentAspectRatio"),
                "minSegmentSolidity":     float_param(params, "minSegmentSolidity"),
                "minSegmentExtent":       float_param(params, "minSegmentExtent"),
            },
        },
        "calibration": {
            "referencePixels":    float_param(params, "referencePixels"),
            "referenceMm":        float_param(params, "referenceMm"),
            "referencePixelSpace": str(params.get("referencePixelSpace") or "original"),
            "referenceX1":        float_param(params, "referenceX1"),
            "referenceY1":        float_param(params, "referenceY1"),
            "referenceX2":        float_param(params, "referenceX2"),
            "referenceY2":        float_param(params, "referenceY2"),
            "enabled":            mm_per_pixel > 0,
            "mm_per_pixel":       round(mm_per_pixel, 8),
            "excluded_reference_object_count": excluded_reference_object_count,
            "suggested_reference": suggested_reference,
        },
        "summary":                 summary,
        "measurements":            measurements,
        "csv":                     measurements_csv(measurements),
        "original_png_base64":     png_base64(prepared.rgb),
        "preprocessed_png_base64": png_base64(segment_input),
        "overlay_png_base64":      png_base64(overlay),
        "sam_mask_png_base64":     png_base64(instance_mask_image),
        "mask_png_base64":         png_base64(mask_image),
        "labels_png_base64":       png_base64(labels_image),
        "label_map_png_base64":    png_base64(label_map),
    }
