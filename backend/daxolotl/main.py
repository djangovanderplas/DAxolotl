"""FastAPI app entry point."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from daxolotl import __version__
from daxolotl.db import init_db
from daxolotl.routers import data, datasets


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize the local SQLite schema before serving requests."""
    init_db()
    yield


app = FastAPI(title="DAxolotl", version=__version__, lifespan=lifespan)

# Vite dev server runs on 5173. Tighten this in production.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(datasets.router)
app.include_router(data.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}
