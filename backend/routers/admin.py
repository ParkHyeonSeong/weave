from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import admin as admin_schema
from core.controller import admin as admin_controller
from library.validator import require_admin
import db_engine as db

router = APIRouter()


@router.post("/users", summary="사용자 수동 추가", dependencies=[Depends(require_admin)])
async def create_user(body: admin_schema.CreateUser, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await admin_controller.create_user(body, request, session)


@router.get("/users", summary="전체 사용자 목록", dependencies=[Depends(require_admin)])
async def list_users(request: Request, session: AsyncSession = Depends(db.session)):
    return await admin_controller.list_users(request, session)


@router.patch("/users/{user_id}/role", summary="사용자 역할 변경", dependencies=[Depends(require_admin)])
async def update_user_role(user_id: int, body: admin_schema.UpdateUserRole,
                           request: Request, session: AsyncSession = Depends(db.session)):
    return await admin_controller.update_user_role(user_id, body, request, session)


@router.patch("/users/{user_id}/status", summary="사용자 상태 변경", dependencies=[Depends(require_admin)])
async def update_user_status(user_id: int, body: admin_schema.UpdateUserStatus,
                             request: Request, session: AsyncSession = Depends(db.session)):
    return await admin_controller.update_user_status(user_id, body, request, session)


@router.delete("/users/{user_id}", summary="사용자 삭제", dependencies=[Depends(require_admin)])
async def delete_user(user_id: int, request: Request, session: AsyncSession = Depends(db.session)):
    return await admin_controller.delete_user(user_id, request, session)


@router.post("/users/{user_id}/reset-password", summary="사용자 비밀번호 초기화", dependencies=[Depends(require_admin)])
async def reset_user_password(user_id: int, body: admin_schema.ResetUserPassword,
                              request: Request, session: AsyncSession = Depends(db.session)):
    return await admin_controller.reset_user_password(user_id, body, request, session)


# ── SMTP 설정 ────────────────────────────────────────────────────────────

@router.get("/smtp-config", summary="SMTP 설정 조회", dependencies=[Depends(require_admin)])
async def get_smtp_config(request: Request, session: AsyncSession = Depends(db.session)):
    return await admin_controller.get_smtp_config(request, session)


@router.put("/smtp-config", summary="SMTP 설정 변경", dependencies=[Depends(require_admin)])
async def update_smtp_config(body: admin_schema.SmtpConfigUpdate, request: Request,
                             session: AsyncSession = Depends(db.session)):
    return await admin_controller.save_smtp_config(body, request, session)


@router.post("/smtp-config/test", summary="SMTP 테스트 발송", dependencies=[Depends(require_admin)])
async def test_smtp(body: admin_schema.SmtpTestRequest, request: Request,
                    session: AsyncSession = Depends(db.session)):
    return await admin_controller.test_smtp(body, request, session)


@router.get("/workspace", summary="워크스페이스 설정 조회", dependencies=[Depends(require_admin)])
async def get_workspace(request: Request, session: AsyncSession = Depends(db.session)):
    return await admin_controller.get_workspace_settings(request, session)


@router.patch("/workspace/time-zone", summary="워크스페이스 시간대 변경",
              dependencies=[Depends(require_admin)])
async def update_workspace_time_zone(body: admin_schema.UpdateWorkspaceTimeZone,
                                     request: Request,
                                     session: AsyncSession = Depends(db.session)):
    return await admin_controller.update_workspace_time_zone(body, request, session)
