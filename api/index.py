"""Serverless entry point.

Vercel runs the exported ASGI application directly. The engine is warmed at
import rather than in the lifespan hook so that a cold start pays the cost once,
before the first request arrives, instead of racing it. Warming reads the
cached forecast cycle and iceberg trajectories off disk and takes well under a
second; nothing here trains anything.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from polarpath.main import app  # noqa: E402
from polarpath.services.engine import ENGINE  # noqa: E402

ENGINE.warm(verbose=False)

__all__ = ["app"]
