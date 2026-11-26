from fastapi import APIRouter, Depends

from app.deps import CurrentUser, current_user

router = APIRouter()


@router.get("/me")
def me(user: CurrentUser = Depends(current_user)) -> dict:
    return {"id": user.id, "email": user.email, "role": user.role}
