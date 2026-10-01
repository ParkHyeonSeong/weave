from typing import Literal, Optional
from pydantic import BaseModel, field_validator

MAX_CONTENT_LENGTH = 300_000


class CanvasPageCreate(BaseModel):
    title: str
    content: Optional[str] = ''
    parent_page_id: Optional[int] = None
    type: str = 'document'

    @field_validator('type')
    @classmethod
    def validate_type(cls, v):
        if v not in ('document', 'folder', 'typst'):
            raise ValueError('type must be "document", "folder", or "typst"')
        return v

    @field_validator('content')
    @classmethod
    def validate_content_length(cls, v):
        if v is not None and len(v) > MAX_CONTENT_LENGTH:
            raise ValueError(f'content exceeds maximum length of {MAX_CONTENT_LENGTH} characters')
        return v


class CanvasPageUpdate(BaseModel):
    # 부모 변경(parent_page_id)과 위치 변경(position)은 트리 무결성 검증이 필요한
    # move 전용 작업이므로 update 스키마에서 제외한다 (CP-002). 부모 변경은
    # /move 엔드포인트(_verify_parent_in_canvas + 사이클 검사)를 통해서만 가능.
    title: Optional[str] = None
    content: Optional[str] = None
    wide_mode: Optional[bool] = None
    # 저장하지 않는 표지 — 공동편집기의 자기 저장(자동 저장·닫기 저장)만 'editor'를 보낸다. 없으면 편집기 밖(MCP·REST)
    # 쓰기로 보고, content를 바꿀 때 공동편집 상태를 비우거나 편집 중이면 거절한다(core/controller/canvas_page.update).
    origin: Optional[Literal['editor']] = None

    @field_validator('content')
    @classmethod
    def validate_content_length(cls, v):
        if v is not None and len(v) > MAX_CONTENT_LENGTH:
            raise ValueError(f'content exceeds maximum length of {MAX_CONTENT_LENGTH} characters')
        return v


class CanvasPageMove(BaseModel):
    parent_page_id: Optional[int] = None
    position: int


class CanvasPageCopy(BaseModel):
    parent_page_id: Optional[int] = None
