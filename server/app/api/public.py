"""Public library routes: no sign-in, GET only. Authorization headers are never read here.
main.py marks every response under /public/ Cache-Control: no-store."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request

from app.deps import public_limit
from app.services import public as svc

router = APIRouter(prefix="/public", dependencies=[Depends(public_limit)])


@router.get("/papers")
def list_papers(request: Request):
    return svc.list_public(request.app.state.engine)


@router.get("/papers/{owner}/{pid}")
def get_paper(owner: str, pid: str, request: Request):
    return svc.get_public(request.app.state.engine, owner, pid)
