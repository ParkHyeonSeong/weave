"""개인 language_region / workspace time_zone 정규화·해석 단일 소스.

프런트(frontend/library/localePrefs.js)와 짝을 이루지만 역할이 다르다:
  · 프런트는 Intl로 **canonical 형태를 만들어** 보낸다('utc'→'UTC', 'US/Eastern'→'America/New_York').
  · 백엔드는 zoneinfo로 **엄격하게 검증만** 한다. tzdata는 대소문자·별칭을 받지 않으므로
    ('utc', 'EST', 'US/Eastern' 전부 거부) 여기가 최종 관문이다.
저장되는 값은 항상 canonical IANA ID다 — 'KST'/'EST' 같은 약어나 숫자 offset은 들어가지 못한다.
"""
import datetime
from zoneinfo import ZoneInfo, available_timezones

SUPPORTED_LOCALES = ('en', 'ko')
DEFAULT_LOCALE = 'en'
FALLBACK_TIME_ZONE = 'UTC'

# 마이그레이션 064 이전 서비스의 사실상 동작. 064 백필 · setup 기본값 · scrum 폴백이 공유한다.
COMPAT_LOCALE = 'ko'
COMPAT_TIME_ZONE = 'Asia/Seoul'

# ui_prefs의 top-level namespace 이름. locale과 time_zone을 별도 키로 쪼개지 않는다 —
# 한 번의 PATCH로 함께 성공하거나 함께 롤백돼야 하기 때문(스펙 §3).
LANGUAGE_REGION_KEY = 'language_region'

_ZONES = None


def _zones():
    global _ZONES
    if _ZONES is None:
        _ZONES = available_timezones()
    return _ZONES


def normalize_locale(raw):
    """'en' | 'ko' 만 통과. 그 외는 None."""
    return raw if raw in SUPPORTED_LOCALES else None


def normalize_time_zone(raw):
    """유효한 IANA timezone ID면 그대로, 아니면 None.

    available_timezones()는 'UTC'를 포함하므로(컨테이너 tzdata 실측) 별도 특례가 필요 없다.
    ZoneInfo 로드까지 확인하는 이유: 목록에 있어도 데이터가 없는 배포가 있을 수 있다.
    """
    if not isinstance(raw, str) or not raw.strip():
        return None
    value = raw.strip()
    if value not in _zones():
        return None
    try:
        ZoneInfo(value)
    except Exception:
        return None
    return value


def normalize_language_region(raw):
    """{'locale', 'time_zone'} 둘 다 유효할 때만 dict를 돌려준다. 반쪽 상태는 None."""
    if not isinstance(raw, dict):
        return None
    locale = normalize_locale(raw.get('locale'))
    time_zone = normalize_time_zone(raw.get('time_zone'))
    if not locale or not time_zone:
        return None
    return {'locale': locale, 'time_zone': time_zone}


def today_in_zone(time_zone, now=None):
    """주어진 IANA timezone에서의 오늘(datetime.date). 유효하지 않으면 UTC로 폴백."""
    tz_name = normalize_time_zone(time_zone) or FALLBACK_TIME_ZONE
    moment = now or datetime.datetime.now(datetime.timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=datetime.timezone.utc)
    return moment.astimezone(ZoneInfo(tz_name)).date()
