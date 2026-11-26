from typing import List, Optional

from fastapi import APIRouter, Depends, Header, Request, Response

from app.deps import CurrentUser, current_user
from app.schemas.papers import CardOut, ForeverIn, PaperIn, PaperOut, PaperPatch, TrashOut
from app.services import papers as svc

router = APIRouter()


def _engine(request: Request):
    return request.app.state.engine


def _max(request: Request) -> int:
    return request.app.state.settings.max_content_bytes


@router.get("/papers", response_model=List[CardOut])
def list_papers(request: Request, user: CurrentUser = Depends(current_user)):
    return svc.list_cards(_engine(request), user.id)


# Declared before /papers/{pid} so these words are never read as paper ids.
@router.get("/papers/trash", response_model=List[TrashOut])
def trash(request: Request, user: CurrentUser = Depends(current_user)):
    return svc.list_trash(_engine(request), user.id)


@router.post("/papers/publish-all")
def publish_all(request: Request, user: CurrentUser = Depends(current_user)):
    return svc.publish_all(_engine(request), user.id)


@router.post("/papers", status_code=201, response_model=PaperOut)
def create(body: PaperIn, request: Request, user: CurrentUser = Depends(current_user)):
    return svc.create_paper(_engine(request), user.id, body.model_dump(exclude_unset=True), _max(request))


@router.delete("/papers")
def delete_many(request: Request, sample: bool = False, x_confirm: Optional[str] = Header(None),
                user: CurrentUser = Depends(current_user)):
    return svc.delete_many(_engine(request), user.id, sample, x_confirm)


@router.get("/papers/{pid}", response_model=PaperOut)
def get(pid: str, request: Request, user: CurrentUser = Depends(current_user)):
    return svc.get_paper(_engine(request), user.id, pid)


@router.patch("/papers/{pid}", response_model=CardOut)
def update(pid: str, body: PaperPatch, request: Request, if_match: Optional[str] = Header(None),
           user: CurrentUser = Depends(current_user)):
    rev = svc.parse_if_match(if_match)
    return svc.update_paper(_engine(request), user.id, pid, rev, body.model_dump(exclude_unset=True), _max(request))


@router.delete("/papers/{pid}", status_code=204)
def delete(pid: str, request: Request, user: CurrentUser = Depends(current_user)):
    svc.delete_paper(_engine(request), user.id, pid)
    return Response(status_code=204)


@router.post("/papers/{pid}/restore", response_model=CardOut)
def restore(pid: str, request: Request, user: CurrentUser = Depends(current_user)):
    return svc.restore_paper(_engine(request), user.id, pid)


@router.delete("/papers/{pid}/forever", status_code=204)
def delete_forever(pid: str, body: ForeverIn, request: Request, user: CurrentUser = Depends(current_user)):
    svc.delete_forever(_engine(request), user.id, pid, body.title)
    return Response(status_code=204)
