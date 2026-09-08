import { isAllowedUri } from '@tiptap/extension-link';
import i18next from '@/library/i18n';

// 스크럼 셀 / Canvas 에디터 공용 링크 헬퍼.
// TipTap setLink는 (1) bare domain을 정규화하지 않고 (2) isAllowedUri 실패 시
// 조용히 no-op이며 (3) 빈 선택에서는 stored mark만 저장해 화면에 아무것도 안 남긴다.
// 이 세 가지를 한곳에서 처리해 Scrum·Canvas 두 툴바와 hover 팝오버가 같은 로직을 공유한다.

// href 안전성 판단은 TipTap의 공개 isAllowedUri를 그대로 재사용한다.
// 기본 허용 스킴 = http/https/ftp/ftps/mailto/tel/callto/sms/cid/xmpp + 경로/앵커.
// 에디터가 custom protocols를 쓰지 않으므로 인자 없이 호출해도 렌더 가드와 동일한 정책이다.
export function isSafeLinkHref(href) {
  // isAllowedUri는 falsy uri를 허용(true)하므로 빈 값은 직접 거른다(라이브 검증 재사용 대비).
  return !!href && !!isAllowedUri(href);
}

// '//' 없이 쓰는 알려진 스킴(mailto:foo 형태). http/https/ftp 등 authority 스킴은 '://'로 따로 처리.
const COLON_SCHEMES = ['mailto', 'tel', 'callto', 'sms', 'cid', 'xmpp'];

// 입력을 클릭 가능한 href로 정규화(스킴/경로 보존, bare domain·host:port만 https).
// 안전성(javascript: 차단 등)은 여기서 판단하지 않고 isSafeLinkHref가 담당한다.
export function normalizeLinkHref(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;        // scheme://authority… (http/https/ftp…)
  const m = v.match(/^([a-z][a-z0-9+.-]*):(.*)$/i);        // scheme:rest 후보
  if (m) {
    if (COLON_SCHEMES.includes(m[1].toLowerCase())) return v;  // mailto:/tel:/sms: 등 알려진 스킴 보존
    if (/^\d/.test(m[2])) return `https://${v}`;               // host:port[/path] → bare URL(example.com:8080)
    return v;                                                  // 기타 스킴형은 보존(javascript: 등은 isSafeLinkHref가 차단)
  }
  if (/^(\/\/|\/|\.\/|\.\.\/|#|\?)/.test(v)) return v;     // 프로토콜상대·루트/상대경로·앵커·쿼리 보존
  if (/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v)) return `mailto:${v}`;  // 이메일(TLD는 문자, host:port 오분류 방지)
  return `https://${v}`;                                   // bare domain → https
}

// 빈 선택 커서가 편집하는 '특정 링크' mark를 반환(없으면 null). 인접한 다른 href 링크와 구분한다.
// 커서 오른쪽(nodeAfter)의 link mark를 본다(내부·왼쪽 경계·단일문자 링크). 오른쪽 inclusive
// 경계(nodeAfter가 비링크/null)는 편집 아님 → null → 새 링크 삽입/무시. (선택이 있으면 selection
// 범위가 명시적이므로 여기서 다루지 않고 isActive/selection으로 처리한다.)
export function editingLinkMark(editor) {
  if (!editor) return null;
  const linkType = editor.schema.marks.link;
  if (!linkType) return null;
  const sel = editor.state.selection;
  if (!sel.empty) return null;
  const after = sel.$from.nodeAfter;
  return after ? (linkType.isInSet(after.marks) || null) : null;
}

// 커서/선택이 '기존 링크를 편집하는' 대상인지. 분기·prefill·빈 입력 해제가 공유한다.
export function isEditingLink(editor) {
  if (!editor) return false;
  return editor.state.selection.empty ? !!editingLinkMark(editor) : editor.isActive('link');
}

// prompt/팝오버 등에서 받은 입력을 에디터에 적용한다.
//  - 빈 입력 → 편집 대상 링크만 해제(인접한 다른 링크는 안 건드림)
//  - 위험 href → no-op
//  - 빈 선택 & 비링크 → URL을 클릭 가능한 텍스트로 삽입(+ stored mark 제거로 연속 입력 차단)
//  - 빈 선택 & 링크 → 그 링크의 '전체 attrs'로 스코프해 갱신(href만 같고 target/title 등이 다른 인접 링크와 구분)
//  - 선택 있음 → 사용자가 고른 범위에만 적용(확장하지 않음 → 인접 링크로 안 번짐)
export function applyLinkValue(editor, raw) {
  if (!editor) return;
  const v = (raw || '').trim();
  const sel = editor.state.selection;
  const mark = editingLinkMark(editor);   // 빈 선택일 때의 특정 링크(없으면 null)
  if (v === '') {
    if (mark) editor.chain().focus().extendMarkRange('link', mark.attrs).unsetLink().run();
    else if (!sel.empty && editor.isActive('link')) editor.chain().focus().unsetLink().run();
    return;
  }
  const href = normalizeLinkHref(v);
  if (!isSafeLinkHref(href)) return;
  if (sel.empty) {
    if (mark) {
      // 대상 링크의 전체 attrs로 스코프 → ProseMirror가 동일 attrs 인접 mark만 하나로 coalesce하므로
      // 이 범위는 정확히 그 링크다(href만 같고 다른 attrs가 다른 인접 링크는 제외).
      editor.chain().focus().extendMarkRange('link', mark.attrs).setLink({ href }).run();
    } else {
      editor.chain().focus()
        .insertContent({ type: 'text', text: v, marks: [{ type: 'link', attrs: { href } }] })
        .unsetMark('link')   // collapsed 커서의 link mark 제거 → inclusive(autolink) 설정과 무관하게 연속 입력 차단
        .run();
    }
  } else {
    editor.chain().focus().setLink({ href }).run();   // 선택 범위에만 적용(확장 X)
  }
}

// 링크 버튼/팝오버 편집용 prompt 래퍼. 편집 대상 링크의 href만 prefill.
export function promptSetLink(editor) {
  if (!editor) return;
  const mark = editingLinkMark(editor);
  const prev = mark ? (mark.attrs.href || '')
    : (isEditingLink(editor) ? (editor.getAttributes('link').href || '') : '');
  // React 밖(툴바 헬퍼)이라 i18next 인스턴스를 직접 읽는다.
  const url = window.prompt(i18next.t('canvas.editor.linkUrlPrompt'), prev);
  if (url === null) return;   // 취소
  applyLinkValue(editor, url);
}
