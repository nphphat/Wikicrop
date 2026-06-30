"""CPU-only mask refinement: GrabCut + edge-snap + contour smoothing.

Design principles:
- All operations are per-instance crop (never full-image distance transforms).
- Conservative: if a step makes the mask worse (area collapses or explodes),
  the original mask is kept.
- Fast: O(crop_area) per grain, not O(full_image_area).
"""

from __future__ import annotations

import cv2
import numpy as np

from .config import bool_param, float_param, int_param
from .yolo_segment import InstanceMask


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def refine_instances_post(
    rgb: np.ndarray,
    instances: list[InstanceMask],
    params: dict,
) -> list[InstanceMask]:
    """Apply GrabCut → edge-snap → contour smoothing to every instance mask.

    All steps operate on per-instance crops (never the full image), keeping
    the per-grain cost proportional to grain size rather than image size.
    """
    enable_grabcut   = bool_param(params, "enableGrabCut")
    enable_edge_snap = bool_param(params, "enableEdgeSnap")
    enable_boundary_refine = bool_param(params, "enableBoundaryRefine")
    smooth_sigma     = float_param(params, "maskContourSmooth")

    if not (enable_boundary_refine or enable_grabcut or enable_edge_snap or smooth_sigma > 0):
        return instances

    padding      = max(int_param(params, "samBoxPadding"), int_param(params, "boundaryRefinePadding"))
    grabcut_iter = int_param(params, "grabCutIter")
    snap_radius  = int_param(params, "edgeSnapRadius")
    snap_sigma   = float_param(params, "edgeSnapSigma")
    boundary_radius = int_param(params, "boundaryRefineRadius")
    boundary_max_area_change = float_param(params, "boundaryRefineMaxAreaChange")
    enable_morph_split = bool_param(params, "enableMorphSplit")
    morph_min_area = int_param(params, "morphSplitMinArea")
    morph_kernel = int_param(params, "morphSplitKernel")
    morph_max_components = int_param(params, "morphSplitMaxComponents")
    morph_min_component_area_ratio = float_param(params, "morphSplitMinComponentAreaRatio")

    height, width = rgb.shape[:2]
    refined: list[InstanceMask] = []

    for instance in instances:
        original_mask = instance.mask.astype(np.uint8)

        # --- compute crop bbox once, share across steps ---
        ys, xs = np.nonzero(original_mask)
        if len(xs) == 0:
            refined.append(instance)
            continue

        x1 = max(0, int(xs.min()) - padding)
        y1 = max(0, int(ys.min()) - padding)
        x2 = min(width,  int(xs.max()) + 1 + padding)
        y2 = min(height, int(ys.max()) + 1 + padding)

        if (x2 - x1) < 4 or (y2 - y1) < 4:
            refined.append(instance)
            continue

        # Work on a crop mask (uint8 0/1)
        crop_mask = original_mask[y1:y2, x1:x2].copy()
        crop_rgb  = rgb[y1:y2, x1:x2]

        orig_area = int(np.count_nonzero(crop_mask))

        if enable_boundary_refine:
            crop_mask = _boundary_refine_crop(
                crop_rgb,
                crop_mask,
                search_radius=boundary_radius,
                max_area_change=boundary_max_area_change,
            )

        if enable_grabcut:
            crop_mask = _grabcut_refine_crop(crop_rgb, crop_mask, iter_count=grabcut_iter)
            # Safety: if area changed by more than 60%, revert
            new_area = int(np.count_nonzero(crop_mask))
            if orig_area > 0 and (new_area == 0 or new_area / orig_area > 1.6 or new_area / orig_area < 0.4):
                crop_mask = original_mask[y1:y2, x1:x2].copy()

        if enable_edge_snap:
            crop_mask = _edge_snap_crop(crop_rgb, crop_mask,
                                        search_radius=snap_radius, sigma=snap_sigma)
            # Safety check
            new_area = int(np.count_nonzero(crop_mask))
            if orig_area > 0 and (new_area == 0 or new_area / orig_area > 1.5 or new_area / orig_area < 0.3):
                crop_mask = original_mask[y1:y2, x1:x2].copy()

        if smooth_sigma > 0:
            crop_mask = _smooth_contour_crop(crop_mask, sigma=smooth_sigma)

        split_masks = [crop_mask]
        if enable_morph_split:
            split_masks = _split_touching_mask_crop(
                crop_mask,
                min_area=morph_min_area,
                kernel_size=morph_kernel,
                max_components=morph_max_components,
                min_component_area_ratio=morph_min_component_area_ratio,
            )

        added = False
        for split_mask in split_masks:
            if not np.any(split_mask):
                continue
            full_mask = np.zeros_like(original_mask, dtype=np.uint8)
            full_mask[y1:y2, x1:x2] = split_mask
            if np.count_nonzero(full_mask) == 0:
                continue
            refined.append(
                InstanceMask(
                    mask=full_mask.astype(bool),
                    confidence=instance.confidence,
                    class_id=instance.class_id,
                    class_name=instance.class_name,
                    source=instance.source,
                )
            )
            added = True
        if not added:
            refined.append(instance)

    return refined


# ---------------------------------------------------------------------------
# Local image-aware boundary refinement
# ---------------------------------------------------------------------------

def _boundary_refine_crop(
    crop_rgb: np.ndarray,
    crop_mask: np.ndarray,
    *,
    search_radius: int,
    max_area_change: float,
) -> np.ndarray:
    """Refine a coarse YOLO mask using local foreground/background colors."""
    original = (crop_mask > 0).astype(np.uint8)
    orig_area = int(np.count_nonzero(original))
    if orig_area < 20:
        return original

    k = max(3, int(search_radius) * 2 + 1)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))
    support = cv2.dilate(original, kernel, iterations=1)
    core_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    core = cv2.erode(original, core_kernel, iterations=1)
    if int(np.count_nonzero(core)) < max(8, int(orig_area * 0.2)):
        core = original

    bg_ring = np.logical_and(support > 0, original == 0)
    if int(np.count_nonzero(bg_ring)) < 12:
        bg_ring = original == 0
    if int(np.count_nonzero(bg_ring)) < 12:
        return original

    rgb_float = crop_rgb.astype(np.float32)
    fg_pixels = rgb_float[core.astype(bool)]
    bg_pixels = rgb_float[bg_ring.astype(bool)]
    if len(fg_pixels) < 8 or len(bg_pixels) < 8:
        return original

    fg_center = np.median(fg_pixels, axis=0)
    bg_center = np.median(bg_pixels, axis=0)
    fg_scale = np.median(np.abs(fg_pixels - fg_center), axis=0) + 12.0
    bg_scale = np.median(np.abs(bg_pixels - bg_center), axis=0) + 12.0

    fg_dist = np.sqrt(np.sum(((rgb_float - fg_center) / fg_scale) ** 2, axis=2))
    bg_dist = np.sqrt(np.sum(((rgb_float - bg_center) / bg_scale) ** 2, axis=2))
    refined = np.logical_and(support > 0, fg_dist <= bg_dist * 0.98).astype(np.uint8)
    refined[core.astype(bool)] = 1
    refined = _keep_main_components_near_original(refined, original)

    new_area = int(np.count_nonzero(refined))
    if new_area <= 0:
        return original
    allowed = max(0.05, min(1.0, float(max_area_change)))
    area_ratio = new_area / max(orig_area, 1)
    if area_ratio < (1.0 - allowed) or area_ratio > (1.0 + allowed):
        return original
    overlap = int(np.count_nonzero(np.logical_and(refined > 0, original > 0)))
    union = int(np.count_nonzero(np.logical_or(refined > 0, original > 0)))
    if union == 0 or overlap / union < 0.55:
        return original
    return refined


def _keep_main_components_near_original(mask: np.ndarray, original: np.ndarray) -> np.ndarray:
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), connectivity=8)
    if n_labels <= 2:
        return mask.astype(np.uint8)
    kept = np.zeros_like(mask, dtype=np.uint8)
    min_area = max(8, int(np.count_nonzero(original) * 0.08))
    for label_id in range(1, n_labels):
        component = labels == label_id
        area = int(stats[label_id, cv2.CC_STAT_AREA])
        if area < min_area:
            continue
        if np.count_nonzero(np.logical_and(component, original > 0)) == 0:
            continue
        kept[component] = 1
    return kept if np.any(kept) else mask.astype(np.uint8)


# ---------------------------------------------------------------------------
# GrabCut — operates on crop
# ---------------------------------------------------------------------------

def _grabcut_refine_crop(
    crop_rgb: np.ndarray,
    crop_mask: np.ndarray,
    *,
    iter_count: int = 3,
) -> np.ndarray:
    """Run GrabCut on a pre-cropped image region."""
    ch, cw = crop_rgb.shape[:2]
    if ch < 4 or cw < 4:
        return crop_mask

    crop_bgr = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2BGR)

    # Build GrabCut mask
    gc_mask = np.full((ch, cw), cv2.GC_BGD, dtype=np.uint8)
    gc_mask[crop_mask == 1] = cv2.GC_PR_FGD

    # Erode to get definite foreground core
    k_size = max(3, min(ch, cw) // 8) | 1
    kernel  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k_size, k_size))
    core    = cv2.erode(crop_mask, kernel, iterations=1)
    gc_mask[core == 1] = cv2.GC_FGD

    if not np.any(gc_mask == cv2.GC_FGD):
        gc_mask[crop_mask == 1] = cv2.GC_FGD

    bgd_model = np.zeros((1, 65), dtype=np.float64)
    fgd_model = np.zeros((1, 65), dtype=np.float64)

    try:
        cv2.grabCut(crop_bgr, gc_mask, None, bgd_model, fgd_model,
                    iter_count, cv2.GC_INIT_WITH_MASK)
    except cv2.error:
        return crop_mask

    fg = np.where(
        (gc_mask == cv2.GC_FGD) | (gc_mask == cv2.GC_PR_FGD), 1, 0
    ).astype(np.uint8)
    return fg


# ---------------------------------------------------------------------------
# Edge-snap — operates on crop (no full-image distance transforms)
# ---------------------------------------------------------------------------

def _edge_snap_crop(
    crop_rgb: np.ndarray,
    crop_mask: np.ndarray,
    *,
    search_radius: int = 6,
    sigma: float = 1.5,
) -> np.ndarray:
    """Snap each contour point to the nearest Canny edge within the crop.

    Uses a simple window-scan per contour point (O(pts × r²)) instead of a
    full-image distance-transform-with-labels, keeping per-grain cost small.
    """
    # Compute Canny on this crop only
    gray     = cv2.cvtColor(crop_rgb, cv2.COLOR_RGB2GRAY)
    blurred  = cv2.GaussianBlur(gray, (5, 5), 0)
    edges    = cv2.Canny(blurred, threshold1=30, threshold2=80)
    edge_ys, edge_xs = np.nonzero(edges)

    # Use approximated contour to reduce point count
    contours, _ = cv2.findContours(crop_mask, cv2.RETR_EXTERNAL,
                                    cv2.CHAIN_APPROX_TC89_KCOS)
    if not contours:
        return crop_mask

    ch, cw = crop_mask.shape[:2]
    result = np.zeros_like(crop_mask)
    new_contours = []

    for contour in contours:
        pts = contour[:, 0, :].astype(np.float64)  # (N, 2) xy

        if sigma > 0:
            pts = _smooth_pts(pts, sigma)

        pts_int = np.clip(np.round(pts).astype(np.int32),
                          [0, 0], [cw - 1, ch - 1])

        if len(edge_xs) == 0:
            # No edges found in crop → keep contour as-is
            new_contours.append(pts_int.reshape(-1, 1, 2))
            continue

        snapped = _snap_pts_to_edges(pts_int, edge_xs, edge_ys, search_radius)
        new_contours.append(snapped.reshape(-1, 1, 2))

    cv2.fillPoly(result, new_contours, 1)
    return result


def _snap_pts_to_edges(
    pts: np.ndarray,       # (N, 2) int [x, y]
    edge_xs: np.ndarray,   # 1-D edge x coords
    edge_ys: np.ndarray,   # 1-D edge y coords
    search_radius: int,
) -> np.ndarray:
    """For each contour point, snap to the nearest edge within search_radius."""
    r2 = search_radius * search_radius
    snapped = pts.copy()

    for i, (x, y) in enumerate(pts):
        dx = edge_xs - x
        dy = edge_ys - y
        d2 = dx * dx + dy * dy
        # Filter to search_radius² window first (fast numpy boolean)
        candidates = np.where(d2 <= r2)[0]
        if len(candidates) == 0:
            continue
        best = candidates[d2[candidates].argmin()]
        snapped[i] = [edge_xs[best], edge_ys[best]]

    return snapped


# ---------------------------------------------------------------------------
# Contour smoothing — operates on crop
# ---------------------------------------------------------------------------

def _smooth_contour_crop(crop_mask: np.ndarray, sigma: float = 1.0) -> np.ndarray:
    """Redraw mask from Gaussian-smoothed contour coordinates."""
    contours, _ = cv2.findContours(crop_mask, cv2.RETR_EXTERNAL,
                                    cv2.CHAIN_APPROX_NONE)
    if not contours:
        return crop_mask

    result = np.zeros_like(crop_mask)
    new_contours = []
    for contour in contours:
        pts = contour[:, 0, :]
        smoothed = _smooth_pts(pts.astype(np.float64), sigma)
        new_contours.append(smoothed.astype(np.int32).reshape(-1, 1, 2))

    cv2.fillPoly(result, new_contours, 1)
    return result


def _smooth_pts(pts: np.ndarray, sigma: float) -> np.ndarray:
    """Apply Gaussian smoothing to a closed polygon (wrap-around padding)."""
    n = len(pts)
    if n < 4:
        return pts
    pad    = min(n, max(3, int(sigma * 3)))
    padded = np.concatenate([pts[-pad:], pts, pts[:pad]], axis=0)
    ksize  = int(sigma * 4) * 2 + 1  # must be odd

    sx = cv2.GaussianBlur(padded[:, 0].reshape(-1, 1).astype(np.float32),
                           (1, ksize), sigma).ravel()
    sy = cv2.GaussianBlur(padded[:, 1].reshape(-1, 1).astype(np.float32),
                           (1, ksize), sigma).ravel()
    return np.stack([sx, sy], axis=1)[pad: pad + n]


def _split_touching_mask_crop(
    crop_mask: np.ndarray,
    *,
    min_area: int,
    kernel_size: int,
    max_components: int,
    min_component_area_ratio: float,
) -> list[np.ndarray]:
    """Split a possibly merged mask by erode->components->dilate on crop."""
    area = int(np.count_nonzero(crop_mask))
    if area < max(1, min_area):
        return [crop_mask]

    k = max(1, int(kernel_size))
    if k % 2 == 0:
        k += 1
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))

    eroded = cv2.erode(crop_mask.astype(np.uint8), kernel, iterations=1)
    n_components, component_labels = cv2.connectedComponents(eroded, connectivity=8)
    split_count = n_components - 1
    if split_count < 2 or split_count > max(2, max_components):
        return [crop_mask]

    min_part_area = max(1, int(round(area * max(0.0, min_component_area_ratio))))
    results: list[np.ndarray] = []
    for label_id in range(1, n_components):
        seed = (component_labels == label_id).astype(np.uint8)
        if not np.any(seed):
            continue
        part = cv2.dilate(seed, kernel, iterations=1)
        part = np.logical_and(part > 0, crop_mask > 0).astype(np.uint8)
        if int(np.count_nonzero(part)) < min_part_area:
            continue
        results.append(part)

    if len(results) < 2:
        return [crop_mask]
    return results
