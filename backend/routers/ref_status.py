from typing import List

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import canvas_page as page_model
from core.model import task as task_model
from core.model import task_issue as issue_model
from core.model import user as user_model
from library.validator import require_login
import db_engine as db

router = APIRouter()


class RefStatusRequest(BaseModel):
    task_ids: List[int] = []
    issue_ids: List[int] = []
    page_ids: List[int] = []
    user_ids: List[int] = []

    @field_validator('task_ids', 'issue_ids', 'page_ids', 'user_ids')
    @classmethod
    def limit_ids(cls, v):
        if len(v) > 200:
            raise ValueError('at most 200 ids')   # API 스키마 검증 메시지(개발자용) — 화면 문구가 아니다
        return v


@router.post("", summary="Ref 상태·제목 배치 조회", dependencies=[Depends(require_login)])
async def batch_ref_status(
    body: RefStatusRequest,
    request: Request,
    session: AsyncSession = Depends(db.session),
):
    user_id = request.state.payload.get('user_id')
    tasks = await task_model.batch_statuses(body.task_ids, user_id, session)
    issues = await issue_model.batch_statuses(body.issue_ids, user_id, session)
    pages = await page_model.batch_titles(body.page_ids, user_id, session)
    users = await user_model.batch_usernames(body.user_ids, session)
    return {'status': True, 'tasks': tasks, 'issues': issues, 'pages': pages, 'users': users}
