import { describe, it, expect, beforeAll } from 'vitest';
import i18next from '@/library/i18n';
import { LABEL_NAME_MAX, labelSaveErrorText, labelSaveFailure, validateLabelDraft } from './labelEdit';

const UX = { label_id: 32, label_name: 'UX 개선', color: '#0D9488' };
const LABELS = [
  { label_id: 33, label_name: 'Frontend', color: '#5E6AD2' },
  UX,
  { label_id: 34, label_name: '검토 필요', color: '#F59E0B' },
];
const judge = (draft) => validateLabelDraft(draft, { original: UX, labels: LABELS });

describe('validateLabelDraft — 이름', () => {
  it('바뀐 것이 없으면 적용할 수 없다', () => {
    expect(judge({ name: 'UX 개선', color: '#0D9488' })).toMatchObject({ canApply: false, changes: {} });
  });
  it('이름만 바꾸면 label_name만 보낸다(앞뒤 공백 제거)', () => {
    expect(judge({ name: '  사용성 개선 ', color: '#0D9488' }))
      .toEqual({ nameError: null, colorError: null, changes: { label_name: '사용성 개선' }, canApply: true });
  });
  it('공백뿐이면 required', () => {
    expect(judge({ name: '   ', color: '#0D9488' })).toMatchObject({ nameError: 'required', canApply: false });
  });
  it(`${LABEL_NAME_MAX}자까지는 되고 넘으면 tooLong (코드 포인트 기준)`, () => {
    expect(judge({ name: 'a'.repeat(100), color: '#0D9488' }).nameError).toBeNull();
    expect(judge({ name: 'a'.repeat(101), color: '#0D9488' }).nameError).toBe('tooLong');
    expect(judge({ name: '😀'.repeat(100), color: '#0D9488' }).nameError).toBeNull();   // UTF-16로는 200
  });
  it('다른 라벨과 정확히 같은 이름이면 duplicate — 대소문자는 구분(DB UNIQUE와 같다)', () => {
    expect(judge({ name: 'Frontend', color: '#0D9488' }).nameError).toBe('duplicate');
    expect(judge({ name: ' Frontend ', color: '#0D9488' }).nameError).toBe('duplicate');
    expect(judge({ name: 'frontend', color: '#0D9488' }).nameError).toBeNull();
  });
  it('자기 자신의 이름은 중복이 아니다(대소문자만 바꾸기 허용)', () => {
    expect(judge({ name: 'ux 개선', color: '#0D9488' })).toMatchObject({ nameError: null, canApply: true });
  });
});

describe('validateLabelDraft — 색', () => {
  it('색만 바꾸면 color만 보낸다', () => {
    expect(judge({ name: 'UX 개선', color: '#DC2626' }))
      .toEqual({ nameError: null, colorError: null, changes: { color: '#DC2626' }, canApply: true });
  });
  it('대소문자만 다른 색은 바뀐 것이 아니다', () => {
    expect(judge({ name: 'UX 개선', color: '#0d9488' })).toMatchObject({ changes: {}, canApply: false });
  });
  it('잘못된 HEX는 invalidHex', () => {
    expect(judge({ name: 'UX 개선', color: '#0D948' })).toMatchObject({ colorError: 'invalidHex', canApply: false });
    expect(judge({ name: 'UX 개선', color: 'teal' })).toMatchObject({ colorError: 'invalidHex', canApply: false });
  });
  it('이름과 색을 함께 바꿀 수 있다', () => {
    expect(judge({ name: '사용성 개선', color: '#2563EB' }).changes).toEqual({ label_name: '사용성 개선', color: '#2563EB' });
  });
  it('저장된 색이 HEX가 아니어도(옛 데이터) 색을 안 건드리면 이름은 바꿀 수 있다', () => {
    const legacy = { label_id: 9, label_name: 'Old', color: 'teal' };
    expect(validateLabelDraft({ name: 'New', color: 'teal' }, { original: legacy, labels: [legacy] }))
      .toMatchObject({ colorError: null, changes: { label_name: 'New' }, canApply: true });
  });
});

describe('labelSaveFailure — 던져진 오류 해석', () => {
  it('응답이 없으면 통신 실패', () => {
    expect(labelSaveFailure(new Error('Network Error'))).toEqual({ ok: false, code: null, category: null, network: true });
  });
  it('500은 본문의 코드·분류', () => {
    const err = { response: { status: 500, data: { status: false, code: 'INTERNAL_SERVER_ERROR', category: 'server' } } };
    expect(labelSaveFailure(err)).toEqual({ ok: false, code: 'INTERNAL_SERVER_ERROR', category: 'server', network: false });
  });
  it('422(스키마 검증)는 본문에 코드가 없어 validation으로 분류', () => {
    const err = { response: { status: 422, data: { detail: [{ msg: 'Value error' }] } } };
    expect(labelSaveFailure(err)).toEqual({ ok: false, code: null, category: 'validation', network: false });
  });
});

describe('labelSaveErrorText', () => {
  beforeAll(async () => { await i18next.changeLanguage('ko'); });
  const t = (k) => i18next.t(k);
  it('통신 실패는 재시도 안내', () => {
    expect(labelSaveErrorText({ network: true }, t)).toBe(t('branchTasks.detail.saveFailedRetry'));
  });
  it('중복 이름 코드는 전용 문구', () => {
    // 키가 없으면 conflict 분류 문구('이미 처리됐거나 충돌이 있어요.')로 떨어진다 — 문구를 그대로 고정한다
    expect(labelSaveErrorText({ code: 'LABEL_ALREADY_EXISTS', category: 'conflict' }, t))
      .toBe('이 브랜치에 같은 이름의 라벨이 이미 있어요.');
  });
  it('검증 분류는 분류 문구', () => {
    expect(labelSaveErrorText({ code: null, category: 'validation' }, t)).toBe(t('errorCategories.validation'));
  });
  it('아무 정보가 없으면 일반 실패 문구', () => {
    expect(labelSaveErrorText({ code: null, category: null }, t)).toBe(t('branchTasks.detail.saveFailed'));
  });
});
