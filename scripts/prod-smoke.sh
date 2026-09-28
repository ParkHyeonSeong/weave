#!/bin/sh
# 운영 백엔드 이미지를 배포 전에 일회용 Postgres로 띄워 시작 절차 전체를 확인한다:
# entrypoint의 마이그레이션 → 앱 시작 → healthcheck → 앱의 DB 경로(/api/setup/status).
# docker-compose.prod.yml의 db·backend 정의를 그대로 쓰되 프로젝트·컨테이너·볼륨·네트워크 이름을 따로 둬서
# 실행 중인 운영 스택과 데이터에는 닿지 않는다. 끝나면 일회용 DB와 볼륨을 지운다.
# 사용: scripts/prod-smoke.sh <backend 이미지>
set -eu

IMAGE="${1:?usage: scripts/prod-smoke.sh <backend image>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND=weave-smoke-backend
ENV_FILE="$(mktemp)"
PW="$(openssl rand -hex 16)"
cat > "$ENV_FILE" <<ENV
POSTGRES_PASSWORD=$PW
DATABASE_URL=postgresql+asyncpg://weave:$PW@db:5432/weave
JWT_SECRET_KEY=$(openssl rand -hex 32)
ENCRYPT_KEY=$(openssl rand -hex 32)
ALLOWED_ORIGINS=http://localhost
NEXT_PUBLIC_API_URL=http://localhost
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
ENV
export SMOKE_BACKEND_IMAGE="$IMAGE"

smoke_compose() {
  docker compose -p weave-smoke --env-file "$ENV_FILE" \
    -f "$ROOT/docker-compose.prod.yml" -f "$ROOT/scripts/prod-smoke.compose.yml" "$@"
}
cleanup() {
  smoke_compose down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}
fail() {
  echo "SMOKE FAIL: $1" >&2
  docker logs --tail 40 "$BACKEND" >&2 2>&1 || true
  exit 1
}
trap cleanup EXIT

smoke_compose down -v --remove-orphans >/dev/null 2>&1 || true   # 지난 실행이 남긴 것 정리
smoke_compose up -d --no-build db backend || fail "compose up failed"

i=0
while :; do
  state="$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$BACKEND" 2>/dev/null || echo missing)"
  case "$state" in
    "running healthy") break ;;
    running*) ;;
    *) fail "backend is '$state' (entrypoint or startup failed)" ;;
  esac
  i=$((i + 1))
  [ "$i" -le 90 ] || fail "backend not healthy after 90s ($state)"
  sleep 1
done

docker exec "$BACKEND" curl -fsS http://localhost:8000/api/setup/status | grep -q '"initialized":false' \
  || fail "/api/setup/status did not answer from the database"
current="$(docker exec "$BACKEND" alembic current 2>/dev/null)"
case "$current" in
  *"(head)"*) ;;
  *) fail "migrations are not at head: current=[$current] heads=[$(docker exec "$BACKEND" alembic heads 2>/dev/null)]" ;;
esac
echo "SMOKE OK: $IMAGE $(docker image inspect -f '{{.Id}}' "$IMAGE") — migrated to $current, healthy, answered /api/setup/status"
