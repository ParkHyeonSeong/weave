from typing import List, Optional
from pydantic import BaseModel, field_validator

from library.crypto import MIN_PASSWORD_LENGTH
from library.locale_prefs import SUPPORTED_LOCALES, normalize_time_zone
from library.user_avatar import AVATAR_COLORS


class UpdateUsername(BaseModel):
    username: str

    @field_validator('username')
    @classmethod
    def validate_username(cls, v):
        v = v.strip()
        if not v:
            raise ValueError('username must not be empty')
        if len(v) > 100:
            raise ValueError('username must be 100 characters or fewer')
        return v


class UpdatePassword(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str

    @field_validator('new_password')
    @classmethod
    def validate_new_password(cls, v):
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f'password must be at least {MIN_PASSWORD_LENGTH} characters')
        return v


class ForceChangePassword(BaseModel):
    new_password: str
    confirm_password: str

    @field_validator('new_password')
    @classmethod
    def validate_new_password(cls, v):
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f'password must be at least {MIN_PASSWORD_LENGTH} characters')
        return v


class UpdateAvatarColor(BaseModel):
    color: Optional[str] = None  # None = 자동(해시 색)으로 복귀

    @field_validator('color')
    @classmethod
    def validate_color(cls, v):
        if v is None:
            return None
        if v not in AVATAR_COLORS:
            raise ValueError('invalid avatar color')
        return v


class LanguageRegion(BaseModel):
    """개인 언어 + 개인 시간대. 한 덩어리로만 저장된다.

    두 값을 별도 top-level 키로 쪼개지 않는 이유: 프런트가 setNamespaceChecked로
    이 객체 하나를 보내야 저장이 함께 성공하거나 함께 롤백된다. 키가 둘이면 PATCH가
    둘로 나뉘어 언어만 저장되고 시간대는 실패한 반쪽 상태가 생긴다.

    locale과 time_zone은 서로를 추론하지 않는다 — English + Asia/Seoul,
    한국어 + America/New_York 조합 모두 유효하다.
    """
    model_config = {'extra': 'forbid'}

    locale: str
    time_zone: str

    @field_validator('locale')
    @classmethod
    def validate_locale(cls, v):
        if v not in SUPPORTED_LOCALES:
            raise ValueError(f"locale must be one of {list(SUPPORTED_LOCALES)}")
        return v

    @field_validator('time_zone')
    @classmethod
    def validate_time_zone(cls, v):
        # zoneinfo 기준 엄격 검증 — 'KST'/'EST'/'utc'/'+09:00'은 전부 거부된다.
        # 프런트가 Intl로 canonical 형태를 만들어 보내는 것이 계약이다.
        normalized = normalize_time_zone(v)
        if not normalized:
            raise ValueError('time_zone must be a valid IANA timezone ID (e.g. Asia/Seoul, America/New_York, UTC)')
        return normalized


class UpdateUiPrefs(BaseModel):
    sidebar_order: Optional[dict] = None
    hidden: Optional[dict] = None
    launchpad_order: Optional[List[str]] = None
    widget_layout: Optional[List[str]] = None
    home_controls: Optional[dict] = None
    saved_view_pins: Optional[dict] = None  # { "<branchId>|global": [view_id, ...] } per-user 핀 순서
    comment_sort: Optional[str] = None  # 'newest' | 'oldest' — 태스크 댓글 정렬 선호
    editor_raw_mode: Optional[bool] = None  # 비협업 에디터 raw markdown 토글 선호 — 전 표면 공통 1개
    theme: Optional[str] = None  # 'light' | 'dark' | 'system' — 다크모드 선호 (기본 system)
    language_region: Optional[LanguageRegion] = None  # { locale, time_zone } — 개인 언어·시간대(원자 저장)

    @field_validator('comment_sort')
    @classmethod
    def validate_comment_sort(cls, v):
        if v is None:
            return None
        if v not in ('newest', 'oldest'):
            raise ValueError("comment_sort must be 'newest' or 'oldest'")
        return v

    @field_validator('theme')
    @classmethod
    def validate_theme(cls, v):
        if v is None:
            return None
        if v not in ('light', 'dark', 'system'):
            raise ValueError("theme must be 'light', 'dark' or 'system'")
        return v
