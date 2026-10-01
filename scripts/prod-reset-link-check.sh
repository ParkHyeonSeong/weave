#!/bin/sh
# make prod-deploy의 첫 단계 — 비밀번호 재설정 메일 링크가 공개 HTTPS 주소로 만들어질지 확인한다. 이미지 빌드(prod-verify)와
# 운영 컨테이너 교체보다 먼저 실행되므로, 실패하면 아무것도 빌드하거나 바꾸지 않는다.
#
# 백엔드(backend/core/controller/admin.py)는 링크 주소를 FRONTEND_URL → ALLOWED_ORIGINS에 있는 요청 Origin → ALLOWED_ORIGINS
# 첫 항목 순으로 정하고, 둘 다 비면 http://localhost:<FRONTEND_PORT, 기본 3000>을 쓴다. 운영 compose는 FRONTEND_URL을 넘기지
# 않으므로 관리자가 접속한 주소에 따라 ALLOWED_ORIGINS의 어느 항목이든 링크 주소가 될 수 있다 — 그래서 항목마다 검사한다.
# 값은 compose가 backend 컨테이너에 실제로 넘길 값(--env-file, 같은 이름의 셸 환경변수, 기본값 반영)에서 이 설정들만 읽고,
# 다른 환경변수나 비밀값은 출력하지 않는다. 형식만 검사한다 — 그 도메인이 정말 이 서버의 주소인지는 알 수 없다.
# 사용: PROD_COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml" scripts/prod-reset-link-check.sh
set -u

: "${PROD_COMPOSE:?PROD_COMPOSE is required}"

# compose 오류 메시지는 보간 실패 시 값 일부를 담을 수 있어 그대로 옮기지 않는다.
if ! config="$($PROD_COMPOSE config --format json backend 2>/dev/null)"; then
  echo "RESET LINK CHECK FAIL: could not read the backend settings from compose. Nothing was built or changed." >&2
  printf '  See the error with: %s config --quiet\n' "$PROD_COMPOSE" >&2
  exit 1
fi

# backend.environment의 값 하나(없으면 빈 값). compose의 JSON은 키마다 한 줄이고, Go 인코더라 < > &는 \u 이스케이프로 나온다.
setting() {
  printf '%s\n' "$config" | sed -n "s/^[[:space:]]*\"$1\": \"\(.*\)\",\{0,1\}\$/\1/p" | head -n 1 |
    sed 's/\\u003c/</g; s/\\u003e/>/g; s/\\u0026/\&/g; s/\\"/"/g; s/\\\\/\\/g'
}

# 링크 주소가 될 값의 문제를 한 줄로 출력한다(문제가 없으면 아무것도 출력하지 않는다).
origin_problem() {
  v="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$v" in
    *'<'*|*'>'*) echo "is still a placeholder from .env.production.example"; return ;;
    https://*) rest="${v#https://}" ;;
    http://*) rest="${v#http://}" ;;
    *) echo "is not an origin (expected https://<public domain>)"; return ;;
  esac
  hostport="${rest%%[/?#]*}"
  case "$hostport" in
    \[*) host="${hostport%%]*}]" ;;  # IPv6 리터럴
    *) host="${hostport%:*}" ;;
  esac
  case "$host" in
    localhost|*.localhost|0.0.0.0|'[::1]'|127.*)
      echo "points at the server itself (localhost), which people opening the reset email cannot reach"; return ;;
    example.com|*.example.com|example.net|*.example.net|example.org|*.example.org|*.example|*.test|*.invalid)
      echo "is a reserved example domain, so the reset email would send people there"; return ;;
  esac
  case ".$host." in  # 문서의 자리표시 이름은 호스트 라벨 단위로만 본다(your-hosting.kr 같은 실제 도메인은 통과)
    *.your-domain.*|*.your-host.*) echo "is still a placeholder from .env.production.example"; return ;;
  esac
  case "$v" in
    http://*) echo "uses http:// but the public site is served over HTTPS (write https://)"; return ;;
  esac
  [ "$rest" = "$hostport" ] || { echo "has a path or trailing slash (write only https://<domain>[:port])"; return; }
  printf '%s\n' "$hostport" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$' ||
    { echo "is not a valid https://<domain>[:port] origin"; return; }
  case "$hostport" in
    *:*) p="${hostport##*:}"  # 위 형식 검사로 1~5자리 숫자다 — 그 범위 밖(65536 등)이면 링크 주소가 유효하지 않다
      [ "$p" -ge 1 ] && [ "$p" -le 65535 ] || echo "has an invalid port :$p (use 1-65535)" ;;
  esac
}

strip_slashes() {  # config.py·admin.py처럼 끝 슬래시를 뗀다
  s="$1"
  while [ "${s%/}" != "$s" ]; do s="${s%/}"; done
  printf '%s' "$s"
}

problems=""
note() { problems="$problems  $1
"; }

frontend_url="$(setting FRONTEND_URL)"
others=""
if [ -n "$frontend_url" ]; then
  # 설정돼 있으면 ALLOWED_ORIGINS와 관계없이 항상 이 주소다. 운영 compose는 원래 넘기지 않으니 누가 추가한 값이다.
  base="$(strip_slashes "$frontend_url")"
  source="FRONTEND_URL"
  why="$(origin_problem "$base")"
  [ -z "$why" ] || note "FRONTEND_URL \"$frontend_url\" $why."
  fix="Fix FRONTEND_URL where it was added to the backend environment, or remove it so ALLOWED_ORIGINS is used,"
else
  base=""
  source="first ALLOWED_ORIGINS entry"
  fix="Set ALLOWED_ORIGINS in .env.production to the public https address people open, e.g. https://<public domain>
(comma-separated if several; no path or trailing slash),"
  set -f; old_ifs="$IFS"; IFS=','
  set -- $(setting ALLOWED_ORIGINS)
  IFS="$old_ifs"; set +f
  for raw in "$@"; do
    entry="$(printf '%s' "$raw" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
    [ -n "$entry" ] || continue  # 백엔드도 빈 항목은 버린다
    why="$(origin_problem "$entry")"
    [ -z "$why" ] || note "ALLOWED_ORIGINS entry \"$entry\" $why."
    if [ -z "$base" ]; then base="$(strip_slashes "$entry")"; else others="$others $entry"; fi
  done
  if [ -z "$base" ]; then
    port="$(setting FRONTEND_PORT)"
    base="http://localhost:${port:-3000}"
    source="backend default, because ALLOWED_ORIGINS is empty"
    note "ALLOWED_ORIGINS is empty."
  fi
fi

if [ -n "$problems" ]; then
  {
    echo "RESET LINK CHECK FAIL: the address for password-reset links is not a valid public https origin. Nothing was built or changed."
    printf '%s' "$problems"
    printf '  Reset links would start with %s/auth/reset?token=... (%s).\n' "$base" "$source"
    printf '%s then run make prod-deploy again.\n' "$fix"
    echo "An exported shell variable of the same name overrides .env.production."
  } >&2
  exit 1
fi

printf 'RESET LINK OK: password-reset links will start with %s/auth/reset (%s).\n' "$base" "$source"
[ -z "$others" ] || printf "  Used instead only when the admin's browser is on that address:%s\n" "$others"
echo "  This checks the format only; make sure it is the address people actually open."
