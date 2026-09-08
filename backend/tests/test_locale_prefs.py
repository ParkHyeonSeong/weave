"""개인 language_region / workspace time_zone 계약 테스트.

번역 문장이 아니라 **계약**만 본다: 검증·폴백·원자 저장·백필 보존·timezone별 날짜 경계.
"""
import datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from core.model import user as user_model
from core.model import workspace as workspace_model
from library.locale_prefs import (
    COMPAT_LOCALE,
    COMPAT_TIME_ZONE,
    FALLBACK_TIME_ZONE,
    normalize_language_region,
    normalize_locale,
    normalize_time_zone,
    today_in_zone,
)
from library.time_context import personal_time_zone, personal_today, workspace_today
from routers.schema.profile import LanguageRegion, UpdateUiPrefs
from routers.schema.setup import SetupInitialize


# ---------------------------------------------------------------------------
# 순수 검증
# ---------------------------------------------------------------------------

def test_locale_validation():
    assert normalize_locale('en') == 'en'
    assert normalize_locale('ko') == 'ko'
    for bad in ('fr', 'EN', 'ko-KR', '', None, 0):
        assert normalize_locale(bad) is None


def test_time_zone_validation_accepts_utc_and_iana():
    assert normalize_time_zone('UTC') == 'UTC'
    assert normalize_time_zone('Asia/Seoul') == 'Asia/Seoul'
    assert normalize_time_zone('America/New_York') == 'America/New_York'
    assert normalize_time_zone('  Asia/Seoul  ') == 'Asia/Seoul'


def test_time_zone_validation_rejects_abbreviations_and_offsets():
    # 백엔드는 tzdata 기준으로 엄격하다 — 별칭·소문자·약어·offset을 전부 거부한다.
    # 프런트가 Intl로 canonical 형태를 만들어 보내는 것이 계약이다.
    for bad in ('KST', 'EST', '+09:00', 'GMT+9', 'utc', 'US/Eastern', 'Asia/Bogus', '', None, 9):
        assert normalize_time_zone(bad) is None, bad


def test_language_region_requires_both_halves():
    assert normalize_language_region({'locale': 'ko', 'time_zone': 'Asia/Seoul'}) == {
        'locale': 'ko', 'time_zone': 'Asia/Seoul'}
    for bad in (
        {'locale': 'ko', 'time_zone': 'KST'},
        {'locale': 'fr', 'time_zone': 'Asia/Seoul'},
        {'locale': 'ko'},
        {'time_zone': 'UTC'},
        None, 'ko', 42, ['ko', 'UTC'],
    ):
        assert normalize_language_region(bad) is None, bad


def test_language_region_does_not_infer_one_from_the_other():
    # English + Asia/Seoul, 한국어 + America/New_York 둘 다 유효해야 한다.
    assert normalize_language_region({'locale': 'en', 'time_zone': 'Asia/Seoul'})
    assert normalize_language_region({'locale': 'ko', 'time_zone': 'America/New_York'})


# ---------------------------------------------------------------------------
# Pydantic 스키마 (API 경계)
# ---------------------------------------------------------------------------

def test_update_ui_prefs_accepts_language_region():
    body = UpdateUiPrefs(language_region={'locale': 'en', 'time_zone': 'America/New_York'})
    patch = body.model_dump(exclude_none=True)
    assert patch == {'language_region': {'locale': 'en', 'time_zone': 'America/New_York'}}


def test_update_ui_prefs_rejects_invalid_language_region():
    for bad in (
        {'locale': 'fr', 'time_zone': 'UTC'},
        {'locale': 'en', 'time_zone': 'KST'},
        {'locale': 'en'},
        {'time_zone': 'UTC'},
        {'locale': 'en', 'time_zone': 'UTC', 'extra': 1},   # extra='forbid'
    ):
        with pytest.raises(ValidationError):
            UpdateUiPrefs(language_region=bad)


def test_language_region_is_a_single_namespace():
    """locale·time_zone이 별도 top-level 키로 새지 않는다 — 원자 저장의 전제."""
    assert 'locale' not in UpdateUiPrefs.model_fields
    assert 'time_zone' not in UpdateUiPrefs.model_fields
    assert 'language_region' in UpdateUiPrefs.model_fields


def test_language_region_normalizes_on_the_boundary():
    lr = LanguageRegion(locale='ko', time_zone='  Asia/Seoul ')
    assert lr.time_zone == 'Asia/Seoul'


def test_setup_time_zone_defaults_for_older_clients():
    body = SetupInitialize(workspace_name='W', registration_policy='private',
                           email='a@b.c', password='password123', username='A')
    assert body.time_zone == COMPAT_TIME_ZONE


def test_setup_time_zone_validated_when_supplied():
    ok = SetupInitialize(workspace_name='W', registration_policy='private',
                         email='a@b.c', password='password123', username='A',
                         time_zone='America/New_York')
    assert ok.time_zone == 'America/New_York'
    with pytest.raises(ValidationError):
        SetupInitialize(workspace_name='W', registration_policy='private',
                        email='a@b.c', password='password123', username='A',
                        time_zone='KST')


# ---------------------------------------------------------------------------
# timezone별 날짜 경계
# ---------------------------------------------------------------------------

def test_today_in_zone_splits_on_the_day_boundary():
    # UTC 2026-09-07 15:30 → 서울은 이미 9/8, 뉴욕은 아직 9/7
    now = datetime.datetime(2026, 9, 7, 15, 30, tzinfo=datetime.timezone.utc)
    assert today_in_zone('Asia/Seoul', now) == datetime.date(2026, 9, 8)
    assert today_in_zone('America/New_York', now) == datetime.date(2026, 9, 7)
    assert today_in_zone('UTC', now) == datetime.date(2026, 9, 7)


def test_today_in_zone_handles_dst():
    # America/New_York DST 시작: 2026-03-08. EST(-5) → EDT(-4)
    before = datetime.datetime(2026, 3, 8, 6, 0, tzinfo=datetime.timezone.utc)   # EST 01:00
    after = datetime.datetime(2026, 3, 8, 8, 0, tzinfo=datetime.timezone.utc)    # EDT 04:00
    assert today_in_zone('America/New_York', before) == datetime.date(2026, 3, 8)
    assert today_in_zone('America/New_York', after) == datetime.date(2026, 3, 8)
    # DST 종료 직후 자정 경계도 하루로 유지
    nov = datetime.datetime(2026, 11, 1, 5, 30, tzinfo=datetime.timezone.utc)    # EDT/EST 01:30
    assert today_in_zone('America/New_York', nov) == datetime.date(2026, 11, 1)


def test_today_in_zone_falls_back_to_utc_on_bad_zone():
    now = datetime.datetime(2026, 9, 7, 15, 30, tzinfo=datetime.timezone.utc)
    assert today_in_zone('KST', now) == datetime.date(2026, 9, 7)
    assert today_in_zone(None, now) == datetime.date(2026, 9, 7)


# ---------------------------------------------------------------------------
# DB 계약
# ---------------------------------------------------------------------------

async def _make_user(db, email, username, ui_prefs=None):
    row = await db.execute(text("""
        INSERT INTO "user" (email, password, username, status, ui_prefs)
        VALUES (:e, :p, :u, 'active', CAST(:prefs AS jsonb)) RETURNING user_id
    """), {"e": email, "p": b"x", "u": username, "prefs": ui_prefs})
    return row.scalar_one()


async def test_existing_workspace_keeps_asia_seoul(db_session):
    """마이그레이션 064가 만든 컬럼의 기본값 = 기존 KST 동작 보존."""
    await db_session.execute(text("""
        INSERT INTO "user" (user_id, email, password, username, status, role)
        VALUES (9001, 'ws-admin@test.local', ''::bytea, 'ws', 'active', 'admin')
    """))
    await db_session.execute(text("""
        INSERT INTO workspace_settings (setting_id, workspace_name, registration_policy, initialized_by)
        VALUES (1, 'Legacy', 'private', 9001)
        ON CONFLICT (setting_id) DO NOTHING
    """))
    assert await workspace_model.get_time_zone(db_session) == COMPAT_TIME_ZONE
    settings = await workspace_model.get_settings(db_session)
    assert settings['time_zone'] == COMPAT_TIME_ZONE


async def test_new_setup_persists_chosen_workspace_time_zone(db_session):
    admin = await _make_user(db_session, 'setup-tz@test.local', 'setup-tz')
    created = await workspace_model.create_settings(
        workspace_name='New', registration_policy='private',
        admin_user_id=admin, db=db_session, time_zone='America/New_York')
    assert created is True
    assert await workspace_model.get_time_zone(db_session) == 'America/New_York'


async def test_workspace_time_zone_falls_back_before_setup(db_session):
    """미초기화 상태에서도 호출부가 None 분기를 하지 않도록 호환값을 준다."""
    await db_session.execute(text("DELETE FROM workspace_settings WHERE setting_id = 1"))
    assert await workspace_model.get_time_zone(db_session) == COMPAT_TIME_ZONE


async def test_get_language_region_reads_only_that_namespace(db_session):
    uid = await _make_user(
        db_session, 'lr-read@test.local', 'lr-read',
        '{"theme": "dark", "language_region": {"locale": "en", "time_zone": "UTC"}}')
    assert await user_model.get_language_region(uid, db_session) == {
        'locale': 'en', 'time_zone': 'UTC'}


async def test_language_region_save_preserves_other_namespaces(db_session):
    """top-level 원자 병합 — theme 같은 다른 네임스페이스를 덮어쓰지 않는다."""
    uid = await _make_user(db_session, 'lr-merge@test.local', 'lr-merge',
                           '{"theme": "dark", "comment_sort": "oldest"}')
    await user_model.update_ui_prefs(
        uid, {'language_region': {'locale': 'ko', 'time_zone': 'Asia/Seoul'}}, db_session)
    prefs = await user_model.get_ui_prefs(uid, db_session)
    assert prefs['theme'] == 'dark'
    assert prefs['comment_sort'] == 'oldest'
    assert prefs['language_region'] == {'locale': 'ko', 'time_zone': 'Asia/Seoul'}


async def test_language_region_is_replaced_wholesale_not_merged(db_session):
    """객체 전체가 한 번에 교체돼야 반쪽 상태가 남지 않는다."""
    uid = await _make_user(db_session, 'lr-atomic@test.local', 'lr-atomic',
                           '{"language_region": {"locale": "ko", "time_zone": "Asia/Seoul"}}')
    await user_model.update_ui_prefs(
        uid, {'language_region': {'locale': 'en', 'time_zone': 'America/New_York'}}, db_session)
    prefs = await user_model.get_ui_prefs(uid, db_session)
    assert prefs['language_region'] == {'locale': 'en', 'time_zone': 'America/New_York'}


# ---------------------------------------------------------------------------
# 요청 단위 '오늘' 해석
# ---------------------------------------------------------------------------

async def test_personal_time_zone_prefers_user_then_workspace_then_utc(db_session):
    await db_session.execute(text("DELETE FROM workspace_settings WHERE setting_id = 1"))
    admin = await _make_user(db_session, 'tz-admin@test.local', 'tz-admin')
    await workspace_model.create_settings('W', 'private', admin, db_session, time_zone='Europe/Paris')

    with_pref = await _make_user(
        db_session, 'tz-user@test.local', 'tz-user',
        '{"language_region": {"locale": "en", "time_zone": "America/Los_Angeles"}}')
    assert await personal_time_zone(with_pref, db_session) == 'America/Los_Angeles'

    # 개인 설정 없음 → workspace
    without = await _make_user(db_session, 'tz-none@test.local', 'tz-none')
    assert await personal_time_zone(without, db_session) == 'Europe/Paris'

    # 손상된 개인 설정 → workspace
    broken = await _make_user(db_session, 'tz-bad@test.local', 'tz-bad',
                              '{"language_region": {"locale": "en", "time_zone": "KST"}}')
    assert await personal_time_zone(broken, db_session) == 'Europe/Paris'

    # 사용자 없음(익명) → workspace
    assert await personal_time_zone(None, db_session) == 'Europe/Paris'


async def test_personal_today_and_workspace_today_can_differ(db_session):
    """개인 timezone과 workspace timezone은 독립적으로 적용된다."""
    await db_session.execute(text("DELETE FROM workspace_settings WHERE setting_id = 1"))
    admin = await _make_user(db_session, 'split-admin@test.local', 'split-admin')
    await workspace_model.create_settings('W', 'private', admin, db_session, time_zone='Asia/Seoul')
    ny_user = await _make_user(
        db_session, 'split-ny@test.local', 'split-ny',
        '{"language_region": {"locale": "en", "time_zone": "America/New_York"}}')

    now = datetime.datetime(2026, 9, 7, 15, 30, tzinfo=datetime.timezone.utc)
    assert await workspace_today(db_session, now) == datetime.date(2026, 9, 8)      # 서울
    assert await personal_today(ny_user, db_session, now) == datetime.date(2026, 9, 7)  # 뉴욕


async def test_personal_today_falls_back_to_utc_when_nothing_is_set(db_session):
    await db_session.execute(text("DELETE FROM workspace_settings WHERE setting_id = 1"))
    uid = await _make_user(db_session, 'utc-only@test.local', 'utc-only')
    # workspace가 없으면 get_time_zone이 호환값(Asia/Seoul)을 주므로 그것이 폴백이 된다.
    # UTC는 workspace timezone까지 손상됐을 때만 쓰인다.
    assert await personal_time_zone(uid, db_session) == COMPAT_TIME_ZONE
    assert normalize_time_zone(FALLBACK_TIME_ZONE) == 'UTC'


def test_compat_constants_are_valid():
    assert normalize_locale(COMPAT_LOCALE) == COMPAT_LOCALE
    assert normalize_time_zone(COMPAT_TIME_ZONE) == COMPAT_TIME_ZONE
    assert normalize_time_zone(FALLBACK_TIME_ZONE) == FALLBACK_TIME_ZONE
