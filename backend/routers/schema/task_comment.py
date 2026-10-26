from typing import Optional
from pydantic import BaseModel, field_validator
from library.html_validator import is_empty_html

# 댓글 길이 한도 — ref 칩 저장 판정(library/ref_chip_ingress)도 같은 값을 쓴다.
CONTENT_MAX_LENGTH = 10000


def _validate_content(v: str) -> str:
    if is_empty_html(v):
        raise ValueError('content is required')
    if len(v) > CONTENT_MAX_LENGTH:
        raise ValueError('content must be 10000 characters or less')
    return v


class CommentCreate(BaseModel):
    content: str
    parent_comment_id: Optional[int] = None

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        return _validate_content(v)


class CommentUpdate(BaseModel):
    content: str

    @field_validator('content')
    @classmethod
    def validate_content(cls, v):
        return _validate_content(v)
