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


def label_rgb(labels: np.ndarray, measurements: list[dict] | None = None) -> np.ndarray:
    height, width = labels.shape[:2]
    output = np.zeros((height, width, 3), dtype=np.uint8)
    outliers = _outlier_ids(measurements)

    # 1. First paint the colored silhouette masks
    for label_id in np.unique(labels):
        if label_id <= 0:
            continue
        color = _color_for_label(int(label_id), outliers) if measurements is not None else PALETTE[(int(label_id) - 1) % len(PALETTE)]
        output[labels == label_id] = color

    # 2. Then draw the actual serial numbers on the centroid of each grain
    for label_id in np.unique(labels):
        if label_id <= 0:
            continue
        component = (labels == label_id).astype(np.uint8)
        M = cv2.moments(component)
        if M["m00"] > 0:
            cX = int(M["m10"] / M["m00"])
            cY = int(M["m01"] / M["m00"])

            # Dynamic font scale based on grain size, tuned for phone previews.
            area = M["m00"]
            font_scale = max(0.75, min(1.25, (area / 4500.0) ** 0.5))

            text = str(int(label_id))
            thickness = 2
            text_size = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, font_scale, thickness)[0]
            text_x = cX - text_size[0] // 2
            text_y = cY + text_size[1] // 2

            # Draw black drop shadow outline for high contrast
            cv2.putText(output, text, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (0, 0, 0), 5, cv2.LINE_AA)
            # Draw white main text.
            cv2.putText(output, text, (text_x, text_y), cv2.FONT_HERSHEY_SIMPLEX, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)

    return output


def overlay_rgb(rgb: np.ndarray, labels: np.ndarray, measurements: list[dict] | None = None) -> np.ndarray:
    output = rgb.copy()
    outliers = _outlier_ids(measurements)

    for label_id in np.unique(labels):
        if label_id <= 0:
            continue
        color = _color_for_label(int(label_id), outliers)
        component_mask = labels == label_id
        output[component_mask] = np.clip(
            (rgb[component_mask].astype(np.float32) * 0.66) + (color.astype(np.float32) * 0.34),
            0,
            255,
        )
        component = (labels == label_id).astype(np.uint8)
        contours, _ = cv2.findContours(component, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cv2.drawContours(output, contours, -1, color.tolist(), 1)
    return output


def mask_rgb(labels: np.ndarray, measurements: list[dict] | None = None) -> np.ndarray:
    height, width = labels.shape[:2]
    output = np.zeros((height, width, 3), dtype=np.uint8)
    outliers = _outlier_ids(measurements)
    for label_id in np.unique(labels):
        if label_id <= 0:
            continue
        output[labels == label_id] = _color_for_label(int(label_id), outliers)
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
