from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path


@lru_cache(maxsize=1)
def settings() -> dict:
    path = Path(__file__).resolve().parents[2] / "config" / "grain.settings.json"
    return json.loads(path.read_text(encoding="utf-8"))


def param_definition(name: str) -> dict:
    return settings().get("params", {}).get(name, {})


def param_default(name: str, fallback=None):
    return param_definition(name).get("default", fallback)


CSV_COLUMNS = settings().get("csvColumns", [])
PALETTE = [tuple(color) for color in settings().get("palette", [])]
PIPELINE_NAME = settings().get("pipeline", "yolo8_nano_segment")
BACKEND_ROOT = Path(__file__).resolve().parents[2]
MODEL_DIR = BACKEND_ROOT / "model"
MODEL_CANDIDATES = (
    "main_model/best.onnx",
    "main_model/best.pt",
    "best.onnx",
    "best.pt",
)


def int_param(params: dict, name: str, default: int | None = None, low: int | None = None, high: int | None = None) -> int:
    definition = param_definition(name)
    if default is None:
        default = int(definition.get("default", 0))
    if low is None:
        low = int(definition.get("min", default))
    if high is None:
        high = int(definition.get("max", default))
    try:
        value = int(params.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(low, min(high, value))


def float_param(params: dict, name: str, default: float | None = None, low: float | None = None, high: float | None = None) -> float:
    definition = param_definition(name)
    if default is None:
        default = float(definition.get("default", 0.0))
    if low is None:
        low = float(definition.get("min", default))
    if high is None:
        high = float(definition.get("max", default))
    try:
        value = float(params.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(low, min(high, value))


def bool_param(params: dict, name: str, default: bool = False) -> bool:
    default = bool(param_default(name, default))
    value = params.get(name, default)
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def model_path(params: dict) -> str:
    definition = param_definition("yoloModelPath")
    env_name = definition.get("env", "GRAIN_YOLO_MODEL")
    default = definition.get("default", "auto")
    raw = str(params.get("yoloModelPath") or os.environ.get(env_name) or default).strip()
    if not raw or raw.lower() == "auto":
        return auto_model_path()
    if raw in MODEL_CANDIDATES:
        return str(MODEL_DIR / raw)
    if raw != "yolov8n-seg.pt":
        return str(Path(raw).expanduser())
    return raw


def auto_model_path() -> str:
    for name in MODEL_CANDIDATES:
        candidate = MODEL_DIR / name
        if candidate.exists():
            return str(candidate)
    return "yolov8n-seg.pt"
