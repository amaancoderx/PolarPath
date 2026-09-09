"""Application entry point.

    uvicorn polarpath.main:app --app-dir backend --port 8000

The engine is warmed on a background thread so the process starts answering
/api/health immediately and the interface can show honest progress instead of a
blank screen.
"""
from __future__ import annotations

import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__
from . import auth
from .api import public, router
from .config import CORS_ORIGINS, PROJECT_ROOT
from .services.engine import ENGINE

DIST = PROJECT_ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    print(auth.banner())
    thread = threading.Thread(target=ENGINE.warm, kwargs={"verbose": True}, daemon=True)
    thread.start()
    yield


app = FastAPI(
    title="PolarPath",
    version=__version__,
    summary="Antarctic sea-ice, iceberg trajectory and navigation decision support",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(public)
app.include_router(router)


if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        candidate = DIST / path
        if path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
