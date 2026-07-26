from __future__ import annotations

import cv2
import numpy as np

from .config import PALETTE


NORMAL_COLOR = np.asarray([37, 99, 235], dtype=np.uint8)
SUSPECT_COLOR = np.asarray([220, 38, 38], dtype=np.uint8)


def _outlier_ids(measurements: list[dict] | None) -> set[int]:
    if not measurements:
        return set()
    return {
        int(item.get("id", -1))
        for item in measurements
        if item.get("qc_outlier") is True
    }


def _color_for_label(label_id: int, outliers: set[int]) -> np.ndarray:
    return SUSPECT_COLOR if label_id in outliers else NORMAL_COLOR


def _label_regions(labels: np.ndarray, measurements: list[dict] | None):
    height, width = labels.shape[:2]
    if measurements:
        for item in measurements:
            label_id = int(item.get("id", 0) or 0)
            if label_id <= 0:
                continue
            x = max(0, int(item.get("bbox_x", 0) or 0))
            y = max(0, int(item.get("bbox_y", 0) or 0))
            w = max(0, int(item.get("bbox_w", 0) or 0))
            h = max(0, int(item.get("bbox_h", 0) or 0))
            if w <= 0 or h <= 0:
                continue
            x2 = min(width, x + w)
            y2 = min(height, y + h)
            mask = labels[y:y2, x:x2] == label_id
            if np.any(mask):
                yield label_id, item, slice(y, y2), slice(x, x2), mask
        return

    for label_id in np.unique(labels):
        if label_id <= 0:
            continue
        mask = labels == label_id
        if np.any(mask):
            yield int(label_id), None, slice(0, height), slice(0, width), mask


def label_rgb(labels: np.ndarray, measurements: list[dict] | None = None) -> np.ndarray:
    height, width = labels.shape[:2]
    output = np.zeros((height, width, 3), dtype=np.uint8)
    outliers = _outlier_ids(measurements)
    regions = list(_label_regions(labels, measurements))

    # 1. First paint the colored silhouette masks
    for label_id, _, y_slice, x_slice, mask in regions:
        color = _color_for_label(int(label_id), outliers) if measurements is not None else PALETTE[(int(label_id) - 1) % len(PALETTE)]
        target = output[y_slice, x_slice]
        target[mask] = color

    # 2. Then draw the actual serial numbers on the centroid of each grain
    for label_id, item, y_slice, x_slice, mask in regions:
        if item is not None:
            cX = int(round(float(item.get("centroid_x", 0) or 0)))
            cY = int(round(float(item.get("centroid_y", 0) or 0)))
            area = float(item.get("area_px", 0) or np.count_nonzero(mask))
        else:
            component = mask.astype(np.uint8)
            M = cv2.moments(component)
            if M["m00"] <= 0:
                continue
            cX = int(M["m10"] / M["m00"]) + x_slice.start
            cY = int(M["m01"] / M["m00"]) + y_slice.start
            area = M["m00"]

        # Dynamic font scale based on grain size, tuned for phone previews.
        font_scale = max(0.75, min(1.25, (area / 4500.0) ** 0.5))

        text = str(int(label_id))
        thickness = 2
        text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)[0]
        text_x = cX - text_size[0] // 2
        text_y = cY + text_size[1] // 2

        # Draw black drop shadow outline for high contrast.
        cv2.putText(output, text, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), 5, cv2.LINE_AA)
        # Draw white main text.
        cv2.putText(output, text, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

    return output


def overlay_rgb(rgb: np.ndarray, labels: np.ndarray, measurements: list[dict] | None = None) -> np.ndarray:
    output = rgb.copy()
    outliers = _outlier_ids(measurements)

    for label_id, _, y_slice, x_slice, mask in _label_regions(labels, measurements):
        color = _color_for_label(int(label_id), outliers)
        source_region = rgb[y_slice, x_slice]
        target_region = output[y_slice, x_slice]
        target_region[mask] = np.clip(
            (source_region[mask].astype(np.float32) * 0.66) + (color.astype(np.float32) * 0.34),
            0,
            255,
        )
        component = mask.astype(np.uint8)
        contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(target_region, contours, -1, color.tolist(), 1)
    return output


def mask_rgb(labels: np.ndarray, measurements: list[dict] | None = None) -> np.ndarray:
    height, width = labels.shape[:2]
    output = np.zeros((height, width, 3), dtype=np.uint8)
    outliers = _outlier_ids(measurements)
    for label_id, _, y_slice, x_slice, mask in _label_regions(labels, measurements):
        target = output[y_slice, x_slice]
        target[mask] = _color_for_label(int(label_id), outliers)
    return output


def label_map_rgb(labels: np.ndarray) -> np.ndarray:
    encoded = np.asarray(labels, dtype=np.uint32)
    output = np.zeros((*labels.shape[:2], 3), dtype=np.uint8)
    output[..., 0] = encoded & 0xFF
    output[..., 1] = (encoded >> 8) & 0xFF
    output[..., 2] = (encoded >> 16) & 0xFF
    return output


def instance_mask_rgb(instances: list) -> np.ndarray:
    if not instances:
        return np.zeros((1, 1, 3), dtype=np.uint8)
    height, width = instances[0].mask.shape[:2]
    mask = np.zeros((height, width), dtype=bool)
    for instance in instances:
        mask = np.logical_or(mask, instance.mask)
    return np.repeat((mask.astype(np.uint8) * 255)[..., None], 3, axis=2)
