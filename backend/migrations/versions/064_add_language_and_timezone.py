"""workspace time_zone 컬럼 + 기존 사용자 language_region 백필

Revision ID: 064
Revises: 063
Create Date: 2026-09-07

무손상 업그레이드가 이 마이그레이션의 유일한 목적이다.

  · 기존 워크스페이스는 Asia/Seoul을 유지한다 — 지금까지 Scrum의 '오늘'과 회고 기간이
    코드에 박힌 KST(timedelta(hours=9))로 계산돼 왔으므로(064 이전 scrum_home/scrum_retro),
    같은 값으로 컬럼을 채워야 배포 전후의 주차·기간이 바이트 단위로 동일하다.

  · 기존 사용자는 locale=ko / time_zone=Asia/Seoul로 백필한다. 백필하지 않으면 배포 직후
    전원이 최초 선택 화면에 막힌다 — 이 서비스의 현행 UI는 한국어이고 사용자는 서울에
    있으므로, 그 값이 곧 '지금 보고 있는 그대로'다. 이후 Profile에서 언제든 바꿀 수 있다.

  · 신규 설치에서는 이 시점에 workspace도 user도 없으므로 백필 대상이 0건이다.
    첫 관리자는 Setup Wizard에서 개인 언어·시간대와 workspace 시간대를 각각 고른다.
"""
from typing import Sequence, Union
from alembic import op

revision: str = '064'
down_revision: Union[str, None] = '063'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COMPAT_TIME_ZONE = 'Asia/Seoul'
COMPAT_LOCALE = 'ko'


def upgrade() -> None:
    # ── workspace 공용 timezone ────────────────────────────────────────────────
    # NOT NULL + DEFAULT 이므로 기존 단일 행(setting_id=1)이 곧바로 호환값을 갖는다.
    op.execute(f"""
        ALTER TABLE workspace_settings
        ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64) NOT NULL DEFAULT '{COMPAT_TIME_ZONE}'
    """)

    # ── 기존 사용자 language_region 백필 ────────────────────────────────────────
    # `||`는 top-level 키 단위 shallow merge라 theme·layout 등 다른 네임스페이스를
    # 건드리지 않는다. WHERE 절이 두 가지를 배제한다:
    #   (1) 이미 **유효한** language_region이 있는 사용자 — 사용자 선택을 덮어쓰지 않는다.
    #       'jsonb_typeof(...) = object' 로 판정한다. 값이 문자열/배열/null 같은 손상된
    #       형태면 백필 대상으로 삼아 정상값으로 되돌린다.
    #   (2) is_system 사용자(GitHub 봇 등) — 로그인하지 않으므로 preference가 무의미하다.
    # 삭제된 사용자(deleted_at)도 제외한다.
    op.execute(f"""
        UPDATE "user"
        SET ui_prefs = COALESCE(ui_prefs, '{{}}'::jsonb)
                       || '{{"language_region": {{"locale": "{COMPAT_LOCALE}",
                                                  "time_zone": "{COMPAT_TIME_ZONE}"}}}}'::jsonb
        WHERE deleted_at IS NULL
          AND is_system = FALSE
          AND jsonb_typeof(COALESCE(ui_prefs, '{{}}'::jsonb) -> 'language_region') IS DISTINCT FROM 'object'
    """)


def downgrade() -> None:
    # 컬럼만 되돌린다.
    #
    # ⚠️ 사용자 ui_prefs의 language_region은 **의도적으로 남긴다.** 이 마이그레이션이 만든
    # 행과 그 뒤 사용자가 직접 고른 값이 DB에서 구분되지 않으므로, 지우면 downgrade가
    # 사용자 선택을 파괴한다. 064 이전 코드는 알 수 없는 JSONB 네임스페이스를 그냥 무시하므로
    # (UpdateUiPrefs 화이트리스트 · 프런트 소비자 모두) 남겨 두는 편이 안전하다.
    op.execute("ALTER TABLE workspace_settings DROP COLUMN IF EXISTS time_zone")
