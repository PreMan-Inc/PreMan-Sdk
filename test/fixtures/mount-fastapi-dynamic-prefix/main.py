"""Pins a non-literal prefix: include_router(..., prefix=API_PREFIX). The route
below is declared on the app itself and keeps full confidence."""

from fastapi import FastAPI

from .routers.reports import router as reports_router

API_PREFIX = "/api"

app = FastAPI()

app.include_router(reports_router, prefix=API_PREFIX)


@app.get("/health")
def health():
    return {"ok": True}
