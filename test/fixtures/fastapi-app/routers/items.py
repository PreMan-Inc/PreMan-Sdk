"""Item routes. The path parameters carry a Starlette type converter."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/v1")


@router.get("/items/{item_id:int}")
def get_item(item_id: int):
    return {"id": item_id}


@router.put("/items/{item_id:int}")
def replace_item(item_id: int):
    return {"id": item_id}
