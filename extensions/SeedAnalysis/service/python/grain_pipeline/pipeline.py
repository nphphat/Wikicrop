from __future__ import annotations

from pathlib import Path

import numpy as np

from .config import PIPELINE_NAME, bool_param, float_param, int_param, model_path
from .fastsam_refine import refine_instances_with_fastsam
from .io import png_base64, read_image
from .mask_refine import refine_instances_post
from .measure import calibration_factor, filter_and_measure, is_seed_instance, measurements_csv, summary_for
from .mobile_sam_refine import is_mobile_sam_model, refine_instances_with_mobile_sam
from .preprocess import apply_light_preprocessing
from .render import instance_mask_rgb, label_map_rgb, label_rgb, mask_rgb, overlay_rgb
from .yolo_segment import predict_instances


def analyze_image(image_path: Path, params: dict) -> dict:
    # ── Stage 0: load & preprocess ──────────────────────────────────────────
    max_side = int_param(params, "maxSide")
    prepared = read_image(image_path, max_side)
    segment_input = apply_light_preprocessing(prepared.rgb, params)

    # ── Stage 1: YOLO-seg ONNX inference ────────────────────────────────────
    yolo_instances = predict_instances(segment_input, params)

    # ── Stage 2: FastSAM-s ONNX refine (opt-in) ─────────────────────────────
    sam_enabled = bool_param(params, "enableSamRefine")
    sam_candidate_limit = int_param(params, "samCandidateLimit")
    use_sam = sam_enabled and len(yolo_instances) <= sam_candidate_limit
    sam_model = str(params.get("samModel") or "previous_model/mobile_sam_decoder.onnx")
    if use_sam and is_mobile_sam_model(sam_model):
        instances = refine_instances_with_mobile_sam(segment_input, yolo_instances, params)
        refiner_name = "MobileSAM ONNX"
    elif use_sam:
        instances = refine_instances_with_fastsam(segment_input, yolo_instances, params)
        refiner_name = "FastSAM-s.onnx"
    else:
        instances = yolo_instances
        refiner_name = "disabled"
    refiner_skip_reason = ""
    if sam_enabled and not use_sam:
        refiner_skip_reason = f"candidate_count>{sam_candidate_limit}"

    # ── Stage 3: CPU mask refinement — GrabCut + edge-snap (opt-in) ─────────
    instances = refine_instances_post(segment_input, instances, params)

    # ── Stage 4: filter & measure ────────────────────────────────────────────
    labels, measurements, excluded_reference_object_count = filter_and_measure(
        instances,
        params,
        prepared.scale,
        segment_input,
    )
    seed_candidate_count = sum(1 for item in instances if is_seed_instance(item))
    ref_candidate_count = len(instances) - seed_candidate_count

    if labels.shape[:2] != segment_input.shape[:2]:
        labels = np.zeros(segment_input.shape[:2], dtype=np.int32)

    summary       = summary_for(measurements)
    overlay       = overlay_rgb(segment_input, labels, measurements)
    labels_image  = label_rgb(labels, measurements)
    mask_image    = mask_rgb(labels, measurements)
    label_map     = label_map_rgb(labels)
    sam_mask_image = instance_mask_rgb(instances)
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
            "pipeline":                "yolo_sam_onnx",
            "execution":               "server_onnxruntime",
            "model":                   model_path(params),
            "refiner":                 refiner_name,
            "refiner_applied":         use_sam,
            "refiner_skip_reason":     refiner_skip_reason,
            "refiner_encoder_model":   str(params.get("samEncoderModel") or "previous_model/mobile_sam_encoder.onnx"),
            "refiner_model":           sam_model,
            "refiner_candidate_limit": sam_candidate_limit,
            "refiner_imgsz":           int_param(params, "samImgSize"),
            "refiner_max_det":         int_param(params, "samMaxDet"),
            "refiner_conf":            float_param(params, "samConf"),
            "refiner_iou":             float_param(params, "samIou"),
            "refiner_box_padding":     int_param(params, "samBoxPadding"),
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
                "ignored_ref_count":      ref_candidate_count,
                "excluded_reference_object_count": excluded_reference_object_count,
            },
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
        },
        "summary":                 summary,
        "measurements":            measurements,
        "csv":                     measurements_csv(measurements),
        "original_png_base64":     png_base64(prepared.rgb),
        "preprocessed_png_base64": png_base64(segment_input),
        "overlay_png_base64":      png_base64(overlay),
        "sam_mask_png_base64":     png_base64(sam_mask_image),
        "mask_png_base64":         png_base64(mask_image),
        "labels_png_base64":       png_base64(labels_image),
        "label_map_png_base64":    png_base64(label_map),
    }
