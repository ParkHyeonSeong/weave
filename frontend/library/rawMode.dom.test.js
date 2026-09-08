// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { buildMarkdownExtensions } from './markdownCodec';
import { enterRawState, parseRawToHtml, formatUnsupportedWarning, closeEditorPopups, shouldAutoEnterRaw } from './rawMode';
import MentionNode, { mentionPluginKey } from '@/components/Canvas/extensions/MentionExtension';

// StarterKit v3에는 underline/link 포함 — TaskDescriptionEditor.js:26-29와 동일 전제
const extensions = buildMarkdownExtensions([StarterKit]);

function makeEditor(content) {
  return new Editor({ extensions, content });
}

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe('enterRawState', () => {
  it('bold 문단을 markdown으로 직렬화하고 경고는 없다', () => {
    editor = makeEditor('<p><strong>굵게</strong> 텍스트</p>');
    const { markdown, warnings } = enterRawState(editor);
    expect(markdown).toContain('**굵게**');
    expect(warnings).toEqual([]);
  });

  it('underline 마크는 ++text++로 무손실 왕복하므로 warnings에 들어가지 않는다', () => {
    editor = makeEditor('<p><u>밑줄</u></p>');
    const { markdown, warnings } = enterRawState(editor);
    expect(markdown).toContain('++밑줄++');
    expect(warnings).not.toContain('underline');
  });
});

describe('parseRawToHtml', () => {
  it('markdown을 에디터 HTML로 파싱한다', () => {
    expect(parseRawToHtml('**bold** 텍스트', extensions)).toContain('<strong>bold</strong>');
  });

  it('공백뿐인 입력은 null (빈 문서 시맨틱)', () => {
    expect(parseRawToHtml('', extensions)).toBeNull();
    expect(parseRawToHtml('  \n  ', extensions)).toBeNull();
  });

  it('왕복: doc → md → html → 다시 md가 동일', () => {
    editor = makeEditor('<p>안녕 <em>세계</em></p><ul><li><p>하나</p></li></ul>');
    const { markdown } = enterRawState(editor);
    editor.commands.setContent(parseRawToHtml(markdown, extensions));
    // 실측(2026-07-09): StarterKit의 TrailingNode 플러그인은 dispatch된 트랜잭션에서만
    // 동작해 initial construction(new Editor({content}))에는 안 붙지만, setContent()
    // 호출(=exitRaw()가 쓰는 것과 동일 경로)이 dispatch하는 트랜잭션에는 붙어 마지막이
    // 문단이 아닌 문서(리스트로 끝남) 뒤에 빈 문단을 추가한다 — rawMode.js 자체의
    // 비순수성이 아니라 tiptap/StarterKit의 실제 동작(코덱은 두 번 다 동일 입력에
    // 동일 출력을 낸다: 첫 markdown은 setContent 이전 JSON, 두번째는 이후 JSON).
    expect(enterRawState(editor).markdown).toBe(`${markdown}\n\n&nbsp;`);
  });
});

describe('closeEditorPopups', () => {
  // 리뷰어 재현: mention(@) 팝업만 열린 상태에서 enterRaw하면 tr이 null이라
  // dispatch가 스킵돼 body에 붙은 fixed 팝업이 고아로 남았다(e5f76eb 누락분).
  // 팝업 컨테이너는 ReactRenderer element(.react-renderer)를 담아 body에 직접
  // append되므로, headless 에디터에서도 생성/정리를 그대로 검증할 수 있다.
  it('mention 팝업이 열려 있으면 상태를 끄고 body의 팝업 DOM을 정리한다', () => {
    const ext = buildMarkdownExtensions([StarterKit, MentionNode]);
    editor = new Editor({ extensions: ext, content: '<p>hello</p>' });
    // jsdom엔 레이아웃이 없어 팝업 위치 계산만 스텁 (생명주기 검증엔 무관)
    editor.view.coordsAtPos = () => ({ left: 0, right: 0, top: 0, bottom: 0 });
    editor.view.dispatch(
      editor.state.tr.setMeta(mentionPluginKey, { active: true, keyword: '', from: 1 }),
    );
    expect(mentionPluginKey.getState(editor.state).active).toBe(true);
    expect(document.body.querySelector('.react-renderer')).not.toBeNull();

    closeEditorPopups(editor);
    expect(mentionPluginKey.getState(editor.state).active).toBe(false);
    expect(document.body.querySelector('.react-renderer')).toBeNull();
  });

  it('활성 팝업이 없으면 아무 트랜잭션도 내지 않는다 (no-op)', () => {
    const ext = buildMarkdownExtensions([StarterKit, MentionNode]);
    editor = new Editor({ extensions: ext, content: '<p>hello</p>' });
    const before = editor.state;
    closeEditorPopups(editor);
    expect(editor.state).toBe(before); // dispatch 자체가 스킵돼 state 동일 참조
  });
});

describe('formatUnsupportedWarning', () => {
  it('빈 배열/undefined면 null', () => {
    expect(formatUnsupportedWarning([])).toBeNull();
    expect(formatUnsupportedWarning(undefined)).toBeNull();
  });
  it('알려진 키는 현재 locale의 라벨로 (ko)', async () => {
    // 문구는 이제 catalog에서 온다 — ko로 전환해 기존 한국어 기대값을 그대로 검증한다.
    const { default: i18next } = await import('@/library/i18n');
    const prev = i18next.language;
    await i18next.changeLanguage('ko');
    try {
      expect(formatUnsupportedWarning(['textAlign', 'color'])).toBe(
        '일부 서식(정렬, 글자색)은 markdown으로 표현되지 않아 단순화됩니다'
      );
    } finally {
      await i18next.changeLanguage(prev);
    }
  });
  it('en에서는 영어 라벨로', async () => {
    const { default: i18next } = await import('@/library/i18n');
    await i18next.changeLanguage('en');
    const text = formatUnsupportedWarning(['textAlign', 'color']);
    expect(text).toMatch(/markdown/i);
    expect(text).not.toMatch(/[가-힣]/);
  });
  it('모르는 키는 그대로 노출', () => {
    expect(formatUnsupportedWarning(['weirdMark'])).toContain('weirdMark');
  });
});

describe('shouldAutoEnterRaw (prefill 인스턴스의 raw 자동 진입 억제)', () => {
  it('raw 선호 + autoEnter 허용이면 true', () => {
    expect(shouldAutoEnterRaw({ editor_raw_mode: true }, true)).toBe(true);
  });
  it('prefill 인스턴스(autoEnter=false)는 선호가 raw여도 진입하지 않는다', () => {
    expect(shouldAutoEnterRaw({ editor_raw_mode: true }, false)).toBe(false);
  });
  it('raw 선호가 없으면 autoEnter와 무관하게 false', () => {
    expect(shouldAutoEnterRaw({}, true)).toBe(false);
    expect(shouldAutoEnterRaw(undefined, true)).toBe(false);
  });
  it('멘션 칩은 raw 왕복에서 평문으로 강등된다 — prefill 인스턴스가 rich로 시작해야 하는 이유', () => {
    const ext = buildMarkdownExtensions([StarterKit, MentionNode]);
    editor = new Editor({
      extensions: ext,
      content: '<p><span data-mention="true" data-user-id="7" data-username="alice">@alice</span>&nbsp;</p>',
    });
    const { markdown } = enterRawState(editor);
    expect(markdown).toContain('@alice'); // 평문 강등 (mention은 md 복원 토크나이저가 없음)
    editor.commands.setContent(parseRawToHtml(markdown, ext));
    expect(JSON.stringify(editor.getJSON())).not.toContain('"mention"'); // 복원 불가 → data-mention 소실 → 알림 소실
  });
});
