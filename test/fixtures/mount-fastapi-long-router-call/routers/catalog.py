"""An idiomatic APIRouter whose argument list runs long. The prefix is the first
argument and the responses block pushes the call well past 400 characters, which is
where the old reader gave up and reported every route below at the site root."""

from fastapi import APIRouter

router = APIRouter(
    prefix="/catalog",
    tags=["catalog"],
    responses={
        400: {"description": "The request body did not match the catalog schema."},
        401: {"description": "No credentials were presented with the request."},
        403: {"description": "The credentials presented do not reach this catalog."},
        404: {"description": "No catalog item exists under the identifier given."},
        409: {"description": "The item was modified by someone else in the meantime."},
        422: {"description": "The request parsed but one of its fields is unusable."},
        500: {"description": "The catalog service failed while handling the request."},
    },
)


@router.get("/items")
def items():
    return []


@router.post("/items")
def create_item():
    return {}
