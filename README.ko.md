<p align="center">
  <img src="frontend/public/icons/weave_square.svg" alt="Weave" width="80" />
</p>

<h1 align="center">Weave</h1>

<p align="center">
  직접 설치해서 쓰는 프로젝트 관리 · 문서 · 채팅 · 주간 스크럼 웹 앱.
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ko.md">한국어</a>
</p>

---

## Weave가 뭔가요?

Weave는 여러분의 서버에 Docker Compose 스택 하나로 올리는 웹 애플리케이션입니다. 팀원이 한 곳에 로그인해서 일을 계획하고, 문서를 쓰고, 대화하고, 주간 스크럼을 진행합니다. 다섯 개의 앱으로 나뉘어 있고, 사용자·알림·검색은 모두 공유합니다:

| 앱 | 무엇인가 |
|---|---|
| **Branch** | 프로젝트. 태스크, 보드, 스프린트, 에픽, 그리고 프로젝트별 설정(상태, 태스크 유형, 라벨, 커스텀 필드)을 담습니다. |
| **Canvas** | 문서 공간. 여러 사람이 동시에 편집하는 페이지들입니다. |
| **Track** | 프로젝트를 가로지르는 뷰. 여러 Branch의 태스크를 하나의 타임라인이나 의존성 그래프로 모읍니다. |
| **Schedule** | Branch의 달력. 일정을 태스크와 연결하고, 스프린트가 달력 위에 표시됩니다. |
| **Scrum** | 주간 보드. 멤버마다 짧은 데일리 스크럼을 적고, 정한 주기마다 팀이 회고를 씁니다. |

그 주변에 1:1·그룹 채팅용 **메신저**, 위젯이 있는 **홈** 화면, 선택 사항인 앱 내 **AI 어시스턴트**, 그리고 Claude 같은 도구가 Weave를 직접 읽고 고칠 수 있게 하는 선택 사항 **MCP 서버**가 있습니다.

## 기능

### Branch (태스크)
- 칸반 보드, 목록, 타임라인(주·월·분기 단위 에픽) 뷰, 그리고 태스크 의존성을 보는 플로우 뷰
- 스프린트(시작, 완료, 미완료 이월), 에픽, 라벨, 우선순위
- Branch마다 정의하는 상태, 태스크 유형, 커스텀 필드
- 태스크 사이의 의존성(blocking / relates-to), Branch를 넘어서도 가능
- 하위태스크(한 단계) 및 이슈(태스크 아래의 버그·하위 이슈 스레드)
- 모든 태스크의 스레드형 댓글과 전체 활동 이력; 태스크 설명·이슈·댓글은 raw markdown으로도 편집 가능
- 저장해서 뷰로 쓰는 필터; 모든 Branch를 아우르는 개인 "My Tasks" 페이지
- GitHub: 풀 리퀘스트에 `WV-123`을 적으면 태스크 상태가 PR을 따라갑니다 ([GitHub App 연동](#github-app-연동) 참고)
- Jira CSV 내보내기에서 프로젝트 가져오기

### Canvas (문서)
- Yjs(CRDT) 기반 실시간 동시 편집과 접속자 표시
- 표, 코드 블록, 수식(KaTeX), Mermaid 다이어그램, 콜아웃, 이미지가 있는 리치 텍스트; URL을 붙여넣으면 미리보기 카드
- Typst 문서 작성과 PDF 내보내기
- 마크다운 양방향: 마크다운을 페이지에 붙여넣기, 어느 페이지든 마크다운으로 복사
- 태스크·문서·이슈 인라인 참조와 호버 미리보기; 선택한 텍스트에 붙는 댓글 스레드
- 드래그 앤 드롭으로 정렬하는 중첩 페이지와 페이지별 이력

### Track
- Flow(의존성 그래프), Timeline(Branch별로 묶은 간트), Tree(마감일순 개요) 뷰
- 에픽·스프린트·필터 단위로 태스크 일괄 추가; 하위태스크는 부모와 함께 들어옵니다

### Schedule
- 스프린트 막대가 표시되는 Branch별 달력; 일정을 태스크에 연결

### Scrum
- 주간 그리드 — 멤버 × 요일 칸 하나씩 — 에 데일리 스크럼 기록
- 회고(Keep / Problem / Try)를 매주, N주마다, 매월, 또는 수동으로 생성

### 메신저
- 이력, `@멘션`, 파일 첨부, 읽음 표시, 접속 상태가 있는 1:1·그룹 채팅
- `/` 명령으로 태스크·문서·이슈 첨부; 채팅을 떠 있는 창으로 분리

### 공통
- 라이트 / 다크 / 시스템 테마
- 영어·한국어 인터페이스; 사용자별 시간대, 그리고 스크럼 주차처럼 팀이 공유하는 날짜를 위한 워크스페이스 시간대
- 앱 내 알림, 브라우저를 닫아도 오는 Web Push 알림
- 어디로든 이동하거나 무엇이든 만드는 `⌘K` 명령 팔레트; 즐겨찾기와 최근 항목
- 위젯(My Tasks, 진행 중 스프린트, 최근, 즐겨찾기)이 있는 홈 화면 — 배치는 사용자별로 저장
- 공개·비공개 Branch와 Canvas; 공개된 것은 둘러보고 참여 가능
- 모든 앱에서 삭제 대신 보관; 보관함에서 복원하거나 영구 삭제
- PWA로 설치 가능; 휴대폰 너비 화면에서도 사용 가능

### AI 어시스턴트 (선택)
- 현재 태스크를 아는, 스트리밍으로 답하는 앱 내 채팅
- Anthropic 또는 OpenAI, 관리자가 설정; API 키는 암호화해서 저장

### 관리
- 최초 실행 설정 마법사: 워크스페이스 이름, 관리자 계정, 가입 정책(자유 가입 또는 승인제)
- 가입 승인·거절, 역할 부여, 비밀번호 재설정 발송
- 워크스페이스 시간대; AI 제공자·SMTP·GitHub App 연동 설정

## 빠른 시작

[Docker](https://docs.docker.com/get-docker/)(Engine 24+, Compose v2)만 있으면 됩니다. Node와 Python은 컨테이너 안에서 돌아가므로 따로 설치하지 않습니다.

```bash
git clone https://github.com/ParkHyeonSeong/weave.git
cd weave
cp .env.example .env
make up-build        # 이미지 빌드, 전체 시작, DB 마이그레이션 실행
```

[http://localhost:3000](http://localhost:3000)을 열고 설정 마법사를 따라 워크스페이스와 첫 관리자 계정을 만듭니다.

선택 — 백그라운드 푸시 알림:

```bash
make generate-vapid  # VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY 출력
# .env에 붙여넣은 뒤, 값을 반영하도록 컨테이너를 다시 만듭니다:
make up
```

자주 쓰는 명령:

```bash
make up            # 시작
make down          # 중지
make logs          # 전체 로그 (make logs-backend / logs-frontend / logs-db 도 있음)
make db-shell      # 데이터베이스 psql
make clean         # 중지하고 모든 데이터(볼륨) 삭제
make help          # 모든 명령 보기
```

| 서비스 | URL |
|---|---|
| 프론트엔드 | http://localhost:3000 |
| 백엔드 API | http://localhost:8000 |
| API 문서 (Swagger) | http://localhost:8000/api/docs — 개발 환경 전용 (`DEBUG=true`) |
| PostgreSQL | localhost:5432 |

포트는 `.env`에서 정합니다. 그 파일에는 개발 스택이 실제로 읽는 값이 무엇인지도 적혀 있습니다: 데이터베이스 계정, `DEBUG`, `LOG_LEVEL`은 `docker-compose.yml` 안에 고정되어 있고 프로덕션에서만 의미가 있습니다.

## 프로덕션 배포

실제 서버에서는 구성이 다릅니다: Nginx 컨테이너만 포트를 노출하고, `DEBUG`는 꺼지며, 백엔드는 제대로 된 시크릿이 없으면 시작을 거부합니다.

```bash
cp .env.production.example .env.production
# JWT_SECRET_KEY, ENCRYPT_KEY, POSTGRES_PASSWORD (+ DATABASE_URL), ALLOWED_ORIGINS, DOMAIN 설정
make prod-build      # 빌드 후 시작
make ssl-init        # DNS가 서버를 가리킨 뒤 한 번
```

전체 절차(SSL, 업데이트, 푸시 알림)는 [DEPLOY.md](DEPLOY.md)에 있습니다. 호스트 리버스 프록시용 참고 설정은 [nginx/host-nginx.conf.example](nginx/host-nginx.conf.example)입니다.

최소 사양: CPU 2코어, RAM 2 GB, 디스크 10 GB, Docker 24+.

기본으로 켜져 있는 것:

- `JWT_SECRET_KEY`, `ENCRYPT_KEY`, 데이터베이스 비밀번호가 없거나 예제 플레이스홀더 그대로면 프로덕션에서 백엔드가 시작되지 않음
- 로그인·가입·비용이 큰 엔드포인트의 요청 제한; CORS는 `ALLOWED_ORIGINS`로 제한
- 사용자가 올린 HTML은 서버에서 정화; 업로드는 확장자가 아니라 내용으로 검사
- URL 미리보기는 DNS를 해석해 사설·내부 주소를 차단(SSRF)
- SMTP·AI 자격 증명은 암호화 저장; GitHub 웹훅은 서명 검증
- 보안 헤더와 CSP는 Nginx 컨테이너가 설정

## GitHub App 연동

선택 사항입니다. 켜면 Weave가 GitHub App의 풀 리퀘스트 웹훅을 받아 PR을 태스크에 연결합니다.

- PR 제목·본문·브랜치 이름에 `<Branch 키>-<번호>` 형식으로 태스크를 적습니다. 예: `WV-123`.
- PR 열림 / 다시 열림 / 리뷰 준비 → 태스크가 Branch의 *in progress* 상태로 이동.
- PR 병합 → *done*. 병합 없이 닫힘 → 다른 열린 PR이 연결돼 있지 않으면 *todo*로 복귀.
- Branch 관리자는 태스크에서 저장소 링크를 추가하고 PR URL을 직접 연결할 수도 있습니다.

설정:

1. 조직에 GitHub App을 만들고 권한 **Metadata: read**, **Pull requests: read**, **Contents: read**를 주고 **Pull request** 이벤트를 구독합니다.
2. 웹훅 URL을 `https://<weave 호스트>/api/github/webhook`으로 설정합니다.
3. App ID, 웹훅 시크릿, 개인 키를 `.env` / `.env.production`에 넣습니다. 키는 PEM 파일을 base64 한 줄로 만든 값입니다:

```bash
base64 -w0 your-app.private-key.pem                 # Linux
base64 -i your-app.private-key.pem | tr -d '\n'     # macOS
```

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY=<base64 PEM>
GITHUB_WEBHOOK_SECRET=<웹훅 시크릿>
```

세 값을 모두 비워 두면 연동이 꺼진 상태로 유지됩니다. 웹훅 요청은 거부되고 백엔드는 시작 시 경고를 남깁니다.

## Weave MCP 서버

[`mcp/`](mcp/)에는 Claude 같은 AI 클라이언트가 Weave의 REST API를 통해 태스크·스프린트·에픽·이슈·문서·트랙·스크럼 보드 등을 읽고 고칠 수 있게 하는 [MCP](https://modelcontextprotocol.io) 서버가 있습니다. 로컬에서 stdio로 동작하고, 프로필에서 만든 Personal Access Token으로 인증합니다. 백엔드 변경은 필요 없습니다.

[`uv`](https://docs.astral.sh/uv/)를 설치한 뒤 MCP 클라이언트의 `.mcp.json`에 추가합니다:

```jsonc
{
  "mcpServers": {
    "weave": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/ParkHyeonSeong/weave#subdirectory=mcp", "weave-mcp"],
      "env": {
        "WEAVE_BASE_URL": "https://weave.example.com",
        "WEAVE_API_TOKEN": "wv_your_token_here"
      }
    }
  }
}
```

도구 목록(184개), 인증 모델, 로컬 개발 방법은 [mcp/README.md](mcp/README.md)(영어)에 있습니다.

## 개발

```
backend/    FastAPI 앱, SQLAlchemy 모델, Alembic 마이그레이션, pytest 스위트
frontend/   Next.js (Pages Router) 앱, SCSS, vitest 스위트
mcp/        MCP 서버 (FastMCP), 자체 pytest 스위트
nginx/      프로덕션 컨테이너용 Nginx 설정과 호스트 프록시 예제
```

개발 스택(`make up-build`)은 `backend/`와 `frontend/`를 컨테이너에 마운트하고 핫리로드하므로, 코드를 고치면 다시 빌드하지 않아도 반영됩니다. 의존성을 바꿨을 때는 `make up-build`를 다시 실행합니다.

테스트 실행:

```bash
# 백엔드 — 이미지에는 런타임 의존성만 있으므로 컨테이너마다 한 번 pytest를 설치합니다
docker compose exec -T backend pip install pytest pytest-asyncio
docker compose exec -T backend python -m pytest tests/ -q

# 프론트엔드 — 호스트에서 Node 22로 (일부 패리티 테스트가 백엔드 소스를 읽고 git을 호출하는데,
# 프론트엔드 컨테이너에는 둘 다 없습니다)
(cd frontend && npm ci --legacy-peer-deps && npm test)

# mcp
(cd mcp && python3 -m venv .venv && .venv/bin/pip install -e ".[dev]" && .venv/bin/pytest)
```

규약과 풀 리퀘스트 체크리스트는 [CONTRIBUTING.md](CONTRIBUTING.md)(영어), 프론트엔드 세부 내용은 [frontend/README.md](frontend/README.md)를 보세요.

## 기술 스택

| 계층 | 기술 |
|---|---|
| 프론트엔드 | Next.js 16 (Pages Router), React 19, SCSS, TipTap 3, Yjs, CodeMirror 6, dnd-kit, React Flow, i18next |
| 에디터 부가 | KaTeX + MathJax (수식), Mermaid (다이어그램), Typst (문서 / PDF), marked + `@tiptap/markdown` (마크다운) |
| 백엔드 | Python 3.13, FastAPI, SQLAlchemy (async), Alembic, pycrdt (Yjs 서버) |
| 데이터베이스 | PostgreSQL 17 |
| 인증 | httpOnly 쿠키의 JWT (짧은 access + refresh), bcrypt; MCP 서버용 Personal Access Token |
| 실시간 | 채팅·알림·동시 편집용 WebSocket |
| 알림 | 앱 내 + Web Push (VAPID) |
| 연동 | GitHub App 웹훅, Jira CSV 가져오기, Anthropic / OpenAI |
| 인프라 | Docker Compose, Nginx (프로덕션); Node 22·Python 3.13 이미지 |

## 라이선스

[MIT](LICENSE). 서드파티 라이선스는 [THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md)에 있습니다.
