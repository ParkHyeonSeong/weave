from typing import Optional

from pydantic import BaseModel, field_validator

from library.crypto import MIN_PASSWORD_LENGTH
from library.locale_prefs import COMPAT_TIME_ZONE, normalize_time_zone
from routers.schema.profile import LanguageRegion


class SetupInitialize(BaseModel):
    workspace_name: str
    registration_policy: str
    email: str
    password: str
    username: str
    # workspace 공용 timezone(Scrum의 오늘·ISO week·회고 기간 경계). 개인 시간대와 다른 설정이다.
    # 이전 클라이언트 호환을 위해 생략 가능하며, 생략 시 마이그레이션 064와 같은 호환값을 쓴다.
    # 새 프런트(SetupWizard)는 항상 명시 전송한다.
    time_zone: str = COMPAT_TIME_ZONE
    # 첫 관리자의 **개인** 언어·시간대(위 workspace time_zone과 별개). 관리자 생성과 같은
    # 트랜잭션에서 user.ui_prefs.language_region에 저장된다 — 설치 뒤 비동기 승격에 기대지 않는다.
    # 이전 클라이언트 호환을 위해 선택 필드다.
    language_region: Optional[LanguageRegion] = None

    @field_validator('registration_policy')
    @classmethod
    def validate_policy(cls, v):
        if v not in ('public', 'private'):
            raise ValueError('registration_policy must be "public" or "private"')
        return v

    @field_validator('password')
    @classmethod
    def validate_password(cls, v):
        if len(v) < MIN_PASSWORD_LENGTH:
            raise ValueError(f'password must be at least {MIN_PASSWORD_LENGTH} characters')
        return v

    @field_validator('time_zone')
    @classmethod
    def validate_time_zone(cls, v):
        normalized = normalize_time_zone(v)
        if not normalized:
            raise ValueError('time_zone must be a valid IANA timezone ID (e.g. Asia/Seoul, America/New_York, UTC)')
        return normalized
