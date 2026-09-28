#!/bin/sh
# 운영 이미지를 빌드하고 백엔드를 일회용 Postgres로 시작해 본다(make prod-verify). 빌드는 배포용 태그
# (<프로젝트>-backend·-frontend)를 새 이미지로 옮기므로, 빌드나 스모크가 실패하거나 중단되면 그 태그를
# 빌드 전에 서비스가 쓰던 이미지로 되돌린다 — 그대로 두면 이어서 실행한 make prod(up -d)가 실패한 후보로
# 서비스를 교체한다. 되돌린 뒤에도 결과는 실패(exit 1)이고, 되돌리기 자체가 실패하면 exit 2로 알린다.
# 사용: PROD_COMPOSE="docker compose --env-file .env.production -f docker-compose.prod.yml" scripts/prod-verify.sh
set -u

: "${PROD_COMPOSE:?PROD_COMPOSE is required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

images="$($PROD_COMPOSE config --images)" || { echo "VERIFY FAIL: cannot read image names from compose" >&2; exit 1; }
backend_tag="$(printf '%s\n' "$images" | grep -- '-backend$')"
frontend_tag="$(printf '%s\n' "$images" | grep -- '-frontend$')"
if [ -z "$backend_tag" ] || [ -z "$frontend_tag" ]; then
  echo "VERIFY FAIL: backend/frontend image names not found in compose config" >&2
  exit 1
fi

# 빌드 전에 되돌릴 이미지에 이름(<태그>:pre-verify)을 붙여 둔다. 빌드가 태그를 옮기면 containerd 이미지 저장소는
# 이름이 하나도 남지 않은 옛 이미지를 곧바로 지워, 그 이미지로 컨테이너가 돌고 있어도 ID로는 다시 태그할 수 없다.
# 되돌릴 이미지는 지금 서비스 컨테이너가 쓰는 이미지이고, 그 이미지를 찾을 수 없으면 빌드 전 태그가 가리키던 이미지
# (지금 make prod가 쓸 이미지)다. 둘 다 없으면(첫 설치) 되돌릴 때 새 태그를 지운다.
pin() {  # $1=container $2=tag — 핀 이름을 출력한다. 고정할 이미지가 없으면(첫 설치) 빈 값, 고정에 실패하면 1
  id="$(docker inspect -f '{{.Image}}' "$1" 2>/dev/null || true)"
  if [ -n "$id" ] && docker tag "$id" "$2:pre-verify" 2>/dev/null; then echo "$2:pre-verify"; return 0; fi
  if docker image inspect "$2" >/dev/null 2>&1; then
    docker tag "$2" "$2:pre-verify" || return 1
    [ -n "$id" ] && echo "note: the image $1 runs is no longer in the image store; restore target is the current $2" >&2
    echo "$2:pre-verify"; return 0
  fi
  [ -z "$id" ] || return 1   # 컨테이너는 있는데 그 이미지도 태그도 찾을 수 없다 — 되돌릴 대상을 정할 수 없다
  docker image rm "$2:pre-verify" >/dev/null 2>&1 || true   # 지난 실행의 핀이 남아 되돌릴 대상을 흐리지 않게
}
backend_pin="$(pin weave-backend "$backend_tag")" && frontend_pin="$(pin weave-frontend "$frontend_tag")" || {
  echo "VERIFY FAIL: could not pin the images the service runs now, so a failed build could not be undone. Nothing was built or changed." >&2
  exit 1
}

restore_tag() {  # $1=tag $2=핀 이름(빈 값이면 빌드 전에 이미지가 없었다)
  if [ -z "$2" ]; then
    docker image inspect "$1" >/dev/null 2>&1 || return 0
    docker image rm "$1" >/dev/null && echo "removed $1 (there was no image before this build)" >&2
    return
  fi
  want="$(docker image inspect -f '{{.Id}}' "$2" 2>/dev/null)" || return 1
  [ "$(docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true)" = "$want" ] && return 0
  docker tag "$2" "$1" && echo "restored $1 -> $want" >&2
}

fail() {  # $1=무엇이 실패했나
  trap - INT TERM
  rc=0
  restore_tag "$backend_tag" "$backend_pin" || rc=1
  restore_tag "$frontend_tag" "$frontend_pin" || rc=1
  if [ "$rc" -ne 0 ]; then
    echo "RESTORE FAILED after: $1. $backend_tag / $frontend_tag may still point at the unverified build." >&2
    echo "Do not run make prod. Re-tag by hand: docker tag ${backend_pin:-<image>} $backend_tag; docker tag ${frontend_pin:-<image>} $frontend_tag" >&2
    exit 2
  fi
  echo "VERIFY FAIL: $1. Image tags point at the running images again; make prod keeps the current version." >&2
  exit 1
}
trap 'fail "interrupted"' INT TERM

$PROD_COMPOSE build || fail "image build failed"
"$ROOT/scripts/prod-smoke.sh" "$backend_tag" || fail "backend smoke test failed"
