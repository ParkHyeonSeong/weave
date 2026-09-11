# Weave Frontend

Next.js 16 (Pages Router) + React 19. 전체 스택은 리포 루트에서 `make up-build`로 띄우는 것이 기본이고, 이 문서는 프론트엔드 안쪽의 구조와 규약만 다룹니다. 제품 설명과 설치는 [../README.ko.md](../README.ko.md)를 보세요.

## 실행

**권장 — 컨테이너 안에서.** 루트에서 `make up-build`. 컨테이너가 `frontend/`를 마운트하고 `next dev`로 핫리로드하므로 코드를 고치면 바로 반영됩니다. `package.json`을 바꿨을 때는 `make up-build`를 다시 실행합니다(이미지를 다시 빌드하고 `node_modules` 볼륨을 갱신).

**단독 실행 — Node 22 필요.**

```bash
npm install          # postinstall 이 patches/ 를 적용합니다 (아래 참고)
npm run dev          # http://localhost:3000
```

백엔드 주소는 `NEXT_PUBLIC_API_URL`로 지정합니다(기본 `http://localhost:8000`). 백엔드는 별도로 떠 있어야 합니다.

## 테스트

```bash
npm test             # vitest run
npm run test:watch
```

루트에서 `make test-frontend`를 실행하면 아래를 그대로 해 줍니다(`package-lock.json`이 바뀌었으면 `npm ci`부터). **호스트에서 실행하는 것을 권장합니다** (Node 22, `npm ci --legacy-peer-deps` 후). 리포 전체가 필요합니다 — 여러 패리티 테스트가 `backend/tests/fixtures`의 골든 픽스처와 백엔드 소스(`backend/library/messages.py` 등)를 직접 읽고, 일부는 `git`을 호출합니다. 컨테이너 안에서(`docker compose exec -T frontend npm test`) 돌리면 그 3개 파일이 실패합니다: 컨테이너에는 `backend/tests/fixtures`만 마운트돼 있고 `node:22-alpine` 이미지에 git이 없기 때문입니다. 테스트 파일은 대상 모듈 옆에 `*.test.js`로 둡니다.

## 디렉터리

```
pages/         라우트 (Pages Router): branch/, canvas/, tracks/, scrum/, admin/, auth/,
               my-tasks.js, profile.js, browse.js, setup.js, 404.js, 500.js
components/    화면 컴포넌트. 앱별(Branch/, Canvas/, Home/, MyTasks/ …)과 공용(Layout/, common/)
library/       도메인 로직·유틸: i18n/ (en.js, ko.js), theme.js, markdownCodec, errorCode.js·errorText.js,
               UiPrefsContext(사용자별 뷰 설정) 등. 테스트도 여기 같이 둡니다
hooks/         React 훅
styles/        SCSS (BEM). _themes.scss 에 라이트/다크 CSS 변수 토큰
public/        정적 자산, PWA(manifest.json, sw.js, offline.html), 부트스트랩 스크립트(theme-boot.js, locale-boot.js)
patches/       patch-package 패치 (typst.ts 의 CSP 관련 패치)
lib/           빌드용 스텁 (wasm 바인딩)
scripts/       다크모드 표면 캡처·감사 도구 (개발용)
```

## 알아둘 것

- **patch-package** — `npm install`의 `postinstall`이 `patches/`를 적용하며, 실패하면 설치가 실패하도록(`--error-on-fail`) 되어 있습니다. Dockerfile이 `patches/`를 `npm ci` 전에 복사하는 이유도 이것입니다. typst.ts 버전을 올리면 패치를 다시 만들어야 합니다.
- **테마** — 색은 `styles/_themes.scss`의 CSS 변수로만 씁니다. 테마 결정 로직은 `library/theme.js` 하나이고, `public/theme-boot.js`는 그것으로 생성한 부트스트랩입니다(FOUC 방지). `theme.js`의 상수를 바꾸면 `theme-boot.js`를 다시 만들어야 하며, 테스트가 불일치를 잡습니다.
- **i18n** — 사용자에게 보이는 문구는 전부 `library/i18n/en.js`와 `ko.js`에 키를 추가하고 `t()`로 씁니다. 두 언어 모두 채웁니다.
- **에디터** — TipTap은 Canvas 페이지뿐 아니라 태스크 설명·이슈·댓글·스크럼 셀 에디터에도 쓰입니다. 확장 배열은 표면별 빌더로 모아 두었고, 새 노드를 추가하면 markdown 직렬화·파싱 핸들러도 같이 필요합니다(스윕 테스트가 강제).
- **에러 표시** — API 에러는 `library/errorCode.js`(`getErrorCode`, `getError`)와 `library/errorText.js`(`errorText`)로만 렌더합니다. 컴포넌트 안에 메시지 맵을 새로 만들지 않습니다.
- **SCSS** — 글로벌 `darken()` / `lighten()` / `saturate()`는 쓰지 않습니다(Dart Sass에서 deprecated). `@use 'sass:color';` 후 `color.adjust($c, $lightness: -8%)`처럼 `sass:color` 모듈을 씁니다.

## 주요 의존성

- **Next.js 16 / React 19**
- **TipTap 3** + **Yjs** (`y-prosemirror`, `y-websocket`) — 리치 텍스트와 실시간 협업
- **CodeMirror 6** (+ `y-codemirror.next`) — 코드·Typst·raw markdown 편집
- **@myriaddreamin/typst.ts** — 브라우저에서 Typst 컴파일·렌더
- **KaTeX**, **MathJax** — 수식 / **Mermaid** — 다이어그램
- **marked**, **@tiptap/markdown**, **react-markdown** — markdown 변환·렌더
- **i18next / react-i18next** — 다국어
- **dnd-kit** — 드래그 앤 드롭 / **@xyflow/react** — 플로우 뷰
- **axios** — API 호출 / **isomorphic-dompurify** — HTML 정화 / **lucide-react** — 아이콘
- **sass** — SCSS / **vitest** + **jsdom** — 테스트
