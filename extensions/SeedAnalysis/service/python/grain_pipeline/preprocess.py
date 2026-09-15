from __future__ import annotations

import cv2
import numpy as np

from .config import bool_param, float_param, int_param


def apply_light_preprocessing(rgb: np.ndarray, params: dict) -> np.ndarray:
    if not bool_param(params, "preprocessImage"):
        return rgb

    output = rgb
    output = gray_world(output, float_param(params, "whiteBalanceStrength"))
    output = clahe_luminance(
        output,
        float_param(params, "claheClipLimit"),
        int_param(params, "claheTileSize"),
    )
    output = denoise(
        output,
        float_param(params, "denoiseStrength"),
        int_param(params, "denoiseDiameter"),
    )
    return output


def gray_world(rgb: np.ndarray, strength: float) -> np.ndarray:
    if strength <= 0:
        return rgb
    image = rgb.astype(np.float32)
    means = image.reshape(-1, 3).mean(axis=0)
    gray = float(np.mean(means))
    scales = gray / np.maximum(means, 1e-6)
    blended = (1.0 - strength) + strength * scales
    return np.clip(image * blended.reshape(1, 1, 3), 0, 255).astype(np.uint8)


def clahe_luminance(rgb: np.ndarray, clip_limit: float, tile_size: int) -> np.ndarray:
    if clip_limit <= 0:
        return rgb
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    l_chan, a_chan, b_chan = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(tile_size, tile_size))
    enhanced = clahe.apply(l_chan)
    return cv2.cvtColor(cv2.merge((enhanced, a_chan, b_chan)), cv2.COLOR_LAB2RGB)


def denoise(rgb: np.ndarray, strength: float, diameter: int) -> np.ndarray:
    if strength <= 0:
        return rgb
    filtered = cv2.bilateralFilter(rgb, diameter, 28, 18)
    return cv2.addWeighted(rgb, 1.0 - strength, filtered, strength, 0)
