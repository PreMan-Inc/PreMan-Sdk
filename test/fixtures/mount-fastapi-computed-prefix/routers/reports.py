from fastapi import APIRouter

router = APIRouter()


@router.get("/reports")
def reports():
    return []
