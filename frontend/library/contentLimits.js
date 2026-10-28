// 서버가 저장 때 검사하는 리치 텍스트 길이 한도(파이썬 글자 수 = 코드 포인트). 원문 모드 A안 판정(rawMode.parseRawToHtml)이 쓴다.
// 정본은 서버 스키마다 — backend/routers/schema/task_comment.py CONTENT_MAX_LENGTH, task_issue.py BODY_MAX_LENGTH·COMMENT_MAX_LENGTH
// (contentLimits.test.js가 같은 값인지 확인한다). 태스크 설명은 서버 한도가 없어 여기에 두지 않는다.
export const TASK_COMMENT_MAX_LENGTH = 10000;
export const ISSUE_BODY_MAX_LENGTH = 50000;
export const ISSUE_COMMENT_MAX_LENGTH = 10000;
