"""notification.payload — 알림을 읽는 사람의 언어로 다시 렌더하기 위한 구조화 데이터

Revision ID: 065
Revises: 064
Create Date: 2026-09-08

알림 title은 지금까지 생성 시점에 한국어 완성 문장으로 굳어 있었다. 한 워크스페이스에
여러 언어 사용자가 있으면 그중 한 명에게는 읽을 수 없는 문장이 남는다.

payload에 {"key": "<메시지 키>", "params": {...}}를 남기면 프런트가 **읽는 시점의**
사용자 언어로 다시 렌더할 수 있다. title 컬럼은 그대로 둔다 — 구버전 행(payload NULL)의
폴백이자 Web Push 본문이며, 새 행에서는 수신자 언어로 채워진다.
"""
from typing import Sequence, Union
from alembic import op

revision: str = '065'
down_revision: Union[str, None] = '064'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NULL 허용 — 기존 행은 title 폴백으로 그대로 읽힌다(데이터 변환 없음).
    op.execute("ALTER TABLE notification ADD COLUMN IF NOT EXISTS payload JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE notification DROP COLUMN IF EXISTS payload")
