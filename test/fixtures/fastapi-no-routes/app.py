"""A FastAPI import and an app object, but not one route decorator."""

from fastapi import FastAPI

app = FastAPI(title="No Routes")


def health():
    return {"status": "ok"}
