"""Pins a two-level include_router chain: /api here, /users in v1.py."""

from fastapi import FastAPI

from .v1 import router as v1_router

app = FastAPI()

app.include_router(v1_router, prefix="/api")


@app.get("/health")
def health():
    return {"ok": True}
