from typing import Optional
from pydantic import BaseModel, field_validator, field_validator

from library.crypto import MIN_PASSWORD_LENGTH


class CreateUser(BaseModel):
    email: str
    username: str
    password: str
    role: str = 'member'

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ('admin', 'member'):
            raise ValueError('role must be "admin" or "member"')
        return v

    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f'password must be at least {MIN_PASSWORD_LENGTH} characters')
        return v


class UpdateUserRole(BaseModel):
    role: str

    @field_validator('role')
    @classmethod
    def validate_role(cls, v):
        if v not in ('admin', 'member'):
            raise ValueError('role must be "admin" or "member"')
        return v


class UpdateUserStatus(BaseModel):
    status: str

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v not in ('active', 'rejected', 'inactive'):
            raise ValueError('status must be "active", "rejected", or "inactive"')
        return v


class SmtpConfigUpdate(BaseModel):
    smtp_host: str
    smtp_port: int = 587
    smtp_user: str
    smtp_password: Optional[str] = None
    sender_email: str
    sender_name: str = ''
    use_tls: bool = True


class SmtpTestRequest(BaseModel):
    test_email: str


class ResetUserPassword(BaseModel):
    """비밀번호 초기화는 본문 필드가 없다 — 단일사용 재설정 링크를 발급할 뿐(SEC-07).

    과거의 new_password(관리자 지정 평문)는 컨트롤러가 무시하던 사일런트 풋건이라 제거했다.
    """
    pass


class UpdateWorkspaceTimeZone(BaseModel):
    """워크스페이스 공용 timezone 변경 — 저장 값은 canonical IANA ID다."""
    time_zone: str

    @field_validator('time_zone')
    @classmethod
    def _valid_zone(cls, v):
        from library.locale_prefs import normalize_time_zone
        tz = normalize_time_zone(v)
        if not tz:
            raise ValueError('INVALID_TIME_ZONE')
        return tz
