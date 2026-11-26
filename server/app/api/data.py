from typing import Any

from fastapi import APIRouter, Body, Depends, Request
from fastapi.responses import StreamingResponse

from app.deps import CurrentUser, current_user
from app.services import papers as svc

router = APIRouter()


@router.get("/export")
def export(request: Request, user: CurrentUser = Depends(current_user)):
    # Streamed: a buffered response over 32 MB would fail on Cloud Run.
    return StreamingResponse(svc.export_papers(request.app.state.engine, user.id), media_type="application/json",
                             headers={"Content-Disposition": 'attachment; filename="journeypaper-export.json"'})


@router.post("/import")
def import_(request: Request, body: Any = Body(...), user: CurrentUser = Depends(current_user)):
    s = request.app.state
    return svc.import_papers(s.engine, user.id, body, s.settings.max_content_bytes)
