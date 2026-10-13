// 라벨 이름·색 편집의 입력 판정과 저장 실패 해석(순수 함수). 화면은 components/common/LabelEditPopover.js.
import { HEX_RE } from '@/library/entityAppearance';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

/** label.label_name VARCHAR(100) — 서버 LabelUpdate 검증과 같은 상한(코드 포인트 수 = PostgreSQL 문자 수) */
export const LABEL_NAME_MAX = 100;

const sameColor = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();

/**
 * 편집 초안 판정. original = 편집을 연 라벨, labels = 같은 브랜치의 라벨 전부.
 * 중복은 서버·DB 규칙(UNIQUE(branch_id, label_name): 대소문자 구분·정확 일치)과 같게
 * 앞뒤 공백을 뗀 이름이 **다른** 라벨 이름과 정확히 같을 때만이다.
 * changes에는 바뀐 필드만 담는다 — 색만 바꾸면 이름을, 이름만 바꾸면 색을 보내지 않는다.
 * 색은 대소문자만 다르면 같은 색으로 본다(네이티브 색 입력은 소문자를 돌려준다).
 */
export function validateLabelDraft({ name, color }, { original, labels }) {
  const trimmed = String(name ?? '').trim();
  let nameError = null;
  if (!trimmed) nameError = 'required';
  else if (Array.from(trimmed).length > LABEL_NAME_MAX) nameError = 'tooLong';
  else if (labels.some((l) => l.label_id !== original.label_id && l.label_name === trimmed)) nameError = 'duplicate';

  const colorChanged = !sameColor(color, original.color);
  const colorError = colorChanged && !HEX_RE.test(String(color ?? '')) ? 'invalidHex' : null;

  const changes = {};
  if (trimmed !== original.label_name) changes.label_name = trimmed;
  if (colorChanged) changes.color = color;
  const canApply = !nameError && !colorError && Object.keys(changes).length > 0;
  return { nameError, colorError, changes, canApply };
}

/** 저장 요청이 던진 오류(axios) → { ok:false, code, category, network }. 응답이 없으면 통신 실패다. */
export function labelSaveFailure(err) {
  const response = err?.response;
  if (!response) return { ok: false, code: null, category: null, network: true };
  const { code, category } = getError(response.data);
  // FastAPI 스키마 검증(422)은 본문에 code가 없다 — 상태로 분류만 붙인다
  const byStatus = response.status === 422 ? 'validation' : (response.status >= 500 ? 'server' : null);
  return { ok: false, code, category: category ?? byStatus, network: false };
}

/** 저장 실패 문구 — 통신 실패는 재시도 안내, 그 밖에는 코드·분류 문구, 둘 다 없으면 일반 실패 문구 */
export function labelSaveErrorText(failure, t) {
  if (failure.network) return t('branchTasks.detail.saveFailedRetry');
  return errorText(failure.code, failure.category) ?? t('branchTasks.detail.saveFailed');
}
