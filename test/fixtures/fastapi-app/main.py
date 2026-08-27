"""Fixture FastAPI app. Every route below is a scanner expectation."""

from fastapi import FastAPI

from .routers import items, users

app = FastAPI(title="Fixture API")

app.include_router(users.router)
app.include_router(items.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/users/{user_id}")
def read_user(user_id: str):
    return {"id": user_id}


@app.post("/users")
def create_user():
    return {"created": True}


@app.api_route("/legacy", methods=["GET", "POST"])
def legacy():
    return {"legacy": True}
