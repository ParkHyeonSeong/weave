// 원문 모드 A안 판정이 쓰는 프런트 한도 = 서버 스키마의 저장 한도(정본). 서버 값이 바뀌면 여기서 걸린다.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TASK_COMMENT_MAX_LENGTH, ISSUE_BODY_MAX_LENGTH, ISSUE_COMMENT_MAX_LENGTH } from './contentLimits';

const schema = (file) => readFileSync(resolve(__dirname, '../../backend/routers/schema', file), 'utf8');
const constant = (src, name) => Number(new RegExp(`^${name} = (\\d+)$`, 'm').exec(src)?.[1]);

describe('리치 텍스트 저장 한도 = 서버 스키마', () => {
  it('태스크 댓글 = task_comment.py CONTENT_MAX_LENGTH', () => {
    expect(TASK_COMMENT_MAX_LENGTH).toBe(constant(schema('task_comment.py'), 'CONTENT_MAX_LENGTH'));
  });
  it('이슈 본문·이슈 댓글 = task_issue.py BODY_MAX_LENGTH·COMMENT_MAX_LENGTH', () => {
    const src = schema('task_issue.py');
    expect(ISSUE_BODY_MAX_LENGTH).toBe(constant(src, 'BODY_MAX_LENGTH'));
    expect(ISSUE_COMMENT_MAX_LENGTH).toBe(constant(src, 'COMMENT_MAX_LENGTH'));
  });
  it('태스크 설명은 서버 한도가 없다(새 한도를 만들지 않는다)', () => {
    const src = schema('task.py');
    expect(src).not.toMatch(/field_validator\('description'/);
    expect(src).not.toMatch(/description:[^\n]*max_length/);
  });
});
