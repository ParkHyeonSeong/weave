# Third-Party Licenses

이 프로젝트는 다음 오픈소스 라이브러리를 사용합니다.

- 범위: 배포물에 포함되는 **런타임 의존성**만 적습니다. 개발·테스트 도구(pytest, ruff, vitest, jsdom, patch-package 등)는 제외합니다.
- 기준: `frontend/package.json`, `backend/pyproject.toml`, `mcp/pyproject.toml`의 의존성과, 설치된 패키지의 라이선스 메타데이터를 대조한 결과 (2026-09-10).
- 의존성을 추가·제거하면 이 파일도 함께 고칩니다.

## Frontend

| Package | License | Link |
|---------|---------|------|
| @codemirror/commands, lang-markdown, language, state, theme-one-dark, view · codemirror | MIT | https://github.com/codemirror |
| @dnd-kit/core, sortable, utilities | MIT | https://github.com/clauderic/dnd-kit |
| @myriaddreamin/typst.ts, typst-ts-renderer, typst-ts-web-compiler | **Apache-2.0** | https://github.com/Myriad-Dreamin/typst.ts |
| @tiptap/react, @tiptap/starter-kit, @tiptap/markdown, @tiptap/extension-* | MIT | https://github.com/ueberdosis/tiptap |
| @tiptap/y-tiptap | MIT | https://github.com/ueberdosis/y-tiptap |
| @xyflow/react | MIT | https://github.com/xyflow/xyflow |
| axios | MIT | https://github.com/axios/axios |
| emoji-picker-react | MIT | https://github.com/ealush/emoji-picker-react |
| hast-util-to-html | MIT | https://github.com/syntax-tree/hast-util-to-html |
| i18next | MIT | https://github.com/i18next/i18next |
| isomorphic-dompurify | MIT | https://github.com/kkomelin/isomorphic-dompurify |
| katex | MIT | https://github.com/KaTeX/KaTeX |
| linkifyjs | MIT | https://github.com/nfrasser/linkifyjs |
| lowlight | MIT | https://github.com/wooorm/lowlight |
| lucide-react | ISC | https://github.com/lucide-icons/lucide |
| marked | MIT | https://github.com/markedjs/marked |
| mathjax | **Apache-2.0** | https://github.com/mathjax/MathJax |
| mermaid | MIT | https://github.com/mermaid-js/mermaid |
| next | MIT | https://github.com/vercel/next.js |
| react, react-dom | MIT | https://github.com/facebook/react |
| react-i18next | MIT | https://github.com/i18next/react-i18next |
| react-markdown | MIT | https://github.com/remarkjs/react-markdown |
| remark-gfm | MIT | https://github.com/remarkjs/remark-gfm |
| remark-math | MIT | https://github.com/remarkjs/remark-math |
| sass | MIT | https://github.com/sass/dart-sass |
| yjs, y-prosemirror, y-codemirror.next, y-websocket | MIT | https://github.com/yjs |

## Backend

| Package | License | Link |
|---------|---------|------|
| FastAPI | MIT | https://github.com/fastapi/fastapi |
| Starlette | BSD-3-Clause | https://github.com/Kludex/starlette |
| uvicorn | BSD-3-Clause | https://github.com/Kludex/uvicorn |
| Pydantic | MIT | https://github.com/pydantic/pydantic |
| python-dotenv | BSD-3-Clause | https://github.com/theskumar/python-dotenv |
| SQLAlchemy | MIT | https://github.com/sqlalchemy/sqlalchemy |
| asyncpg | **Apache-2.0** | https://github.com/MagicStack/asyncpg |
| Alembic | MIT | https://github.com/sqlalchemy/alembic |
| bcrypt | **Apache-2.0** | https://github.com/pyca/bcrypt |
| PyJWT | MIT | https://github.com/jpadilla/pyjwt |
| python-multipart | **Apache-2.0** | https://github.com/Kludex/python-multipart |
| pycrdt | MIT | https://github.com/y-crdt/pycrdt |
| httpx | BSD-3-Clause | https://github.com/encode/httpx |
| beautifulsoup4 | MIT | https://www.crummy.com/software/BeautifulSoup/ |
| pywebpush | **MPL-2.0** | https://github.com/web-push-libs/pywebpush |
| aiohttp | **Apache-2.0** AND MIT | https://github.com/aio-libs/aiohttp |
| slowapi | MIT | https://github.com/laurents/slowapi |
| defusedxml | **PSF-2.0** | https://github.com/tiran/defusedxml |
| nh3 | MIT | https://github.com/messense/nh3 |
| markdownify | MIT | https://github.com/matthewwithanm/python-markdownify |
| markdown-it-py | MIT | https://github.com/executablebooks/markdown-it-py |
| mdit-py-plugins | MIT | https://github.com/executablebooks/mdit-py-plugins |
| cryptography | **Apache-2.0** OR BSD-3-Clause | https://github.com/pyca/cryptography |

## MCP server (`mcp/`)

| Package | License | Link |
|---------|---------|------|
| fastmcp | **Apache-2.0** | https://github.com/jlowin/fastmcp |
| httpx | BSD-3-Clause | https://github.com/encode/httpx |
| python-dotenv | BSD-3-Clause | https://github.com/theskumar/python-dotenv |

## Database

| Software | License | Link |
|----------|---------|------|
| PostgreSQL | PostgreSQL License | https://www.postgresql.org/about/licence/ |

---

### License Compatibility Notes

- **Apache-2.0** (typst.ts, mathjax, asyncpg, bcrypt, python-multipart, aiohttp, cryptography, fastmcp): permissive license, MIT 프로젝트와 호환. 재배포 시 해당 패키지의 NOTICE 파일 포함 필요.
- **MPL-2.0** (pywebpush): 파일 단위 copyleft. 수정 없이 사용하므로 호환. 수정 시 해당 파일만 MPL-2.0으로 공개 필요.
- **PSF-2.0** (defusedxml): Python Software Foundation License. permissive, MIT와 호환.
- **ISC** (lucide-react): MIT와 사실상 동일한 permissive license.
- **BSD-3-Clause** (Starlette, uvicorn, python-dotenv, httpx): permissive license, MIT와 호환.
- **PostgreSQL License**: BSD 계열 permissive license.
