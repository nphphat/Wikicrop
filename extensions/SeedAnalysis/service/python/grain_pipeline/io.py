from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageOps


@dataclass(frozen=True)
class PreparedImage:
    rgb: np.ndarray
    original_width: int
    original_height: int
    scale: float


def read_image(path: Path, max_side: int) -> PreparedImage:
    image = Image.open(path)
    image = ImageOps.exif_transpose(image).convert("RGB")
    rgb = np.asarray(image, dtype=np.uint8)
    original_height, original_width = rgb.shape[:2]
    longest = max(original_height, original_width)
    if longest <= max_side:
        return PreparedImage(rgb.copy(), original_width, original_height, 1.0)

    scale = max_side / float(longest)
    new_size = (
        max(1, int(round(original_width * scale))),
        max(1, int(round(original_height * scale))),
    )
    resized = cv2.resize(rgb, new_size, interpolation=cv2.INTER_AREA)
    return PreparedImage(resized, original_width, original_height, scale)


def png_base64(rgb_or_gray: np.ndarray) -> str:
    import base64

    if rgb_or_gray.ndim == 2:
        encoded_source = rgb_or_gray
    else:
        encoded_source = cv2.cvtColor(rgb_or_gray, cv2.COLOR_RGB2BGR)
    ok, buffer = cv2.imencode(".png", encoded_source)
    if not ok:
        return ""
    return base64.b64encode(buffer.tobytes()).decode("ascii")
