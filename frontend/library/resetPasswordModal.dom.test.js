// @vitest-environment jsdom
// 관리자 비밀번호 재설정 모달(OB-01): 만료 안내는 서버가 준 시간을 그대로 쓰고,
// 메일 발송이 실패하면 짧은 사유와 복사할 링크를 함께 보여준다.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('@/library/_axios', () => ({ axios: { post: vi.fn() } }));
import { axios } from '@/library/_axios';

import i18next from '@/library/i18n';
import ResetPassword from '@/components/modal/ResetPassword';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = { user_id: 7, username: 'kim', email: 'kim@example.com' };
const LINK = 'https://weave.example.com/auth/reset?token=rst_abc';

let root = null;
beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(async () => {
  if (root) { await act(async () => root.unmount()); root = null; }
  await i18next.changeLanguage('en');
});

async function submitWith(data, lng) {
  await i18next.changeLanguage(lng);
  axios.post.mockResolvedValue({ data });
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<ResetPassword user={USER} onClose={() => {}} />); });
  await act(async () => { document.querySelector('.ResetPassword__SubmitBtn').click(); });
  await act(async () => {});
  expect(axios.post).toHaveBeenCalledWith('/admin/users/7/reset-password', {});
  return document.querySelector('.ResetPassword');
}

const text = (modal, sel) => modal.querySelector(sel)?.textContent;

describe('ResetPassword — 메일 발송 성공', () => {
  it.each([
    ['en', 24, 'The link can be used once and expires in 24 hours.'],
    ['en', 1, 'The link can be used once and expires in 1 hour.'],
    ['ko', 24, '이 링크는 한 번만 사용할 수 있으며 24시간 후 만료됩니다.'],
  ])('%s: 서버의 만료 시간(%s)을 그대로 안내하고 링크는 보여주지 않는다', async (lng, hours, notice) => {
    const modal = await submitWith({ status: true, email_sent: true, expires_hours: hours }, lng);
    expect(text(modal, '.ResetPassword__Notice')).toBe(notice);
    expect(modal.textContent).toContain(USER.email);
    expect(modal.querySelector('.ResetPassword__LinkText')).toBeNull();
  });
});

describe('ResetPassword — 메일 발송 실패', () => {
  it.each([
    // 같은 코드가 수신 거부(받는 주소 문제)도 덮으므로 SMTP 설정만 탓하지 않는다
    ['en', 'SMTP_SEND_FAILED', 'We could not send the email. Check the SMTP settings in Integrations or the recipient address.', '2 hours'],
    ['ko', 'SMTP_SEND_FAILED', '메일을 보내지 못했어요. 연동 화면의 SMTP 설정이나 받는 사람 주소를 확인해 주세요.', '2시간'],
    ['en', 'SMTP_TIMEOUT', 'The mail server did not respond in time, so we could not confirm the email was sent.', '2 hours'],
    ['ko', 'SMTP_TIMEOUT', '메일 서버가 제시간에 응답하지 않아 발송을 확인하지 못했어요.', '2시간'],
  ])('%s · %s: 짧은 사유 + 복사할 링크 + 실제 만료 시간', async (lng, code, reason, hoursText) => {
    const modal = await submitWith({
      status: true, email_sent: false, email_error: code,
      reset_link: LINK, reset_token: 'rst_abc', expires_hours: 2,
    }, lng);
    expect(text(modal, '.ResetPassword__Error')).toBe(reason);
    expect(text(modal, '.ResetPassword__LinkText')).toBe(LINK);
    expect(modal.querySelector('.ResetPassword__CopyBtn')).not.toBeNull();
    expect(text(modal, '.ResetPassword__Notice')).toContain(hoursText);
  });

  it.each([
    ['en', 'The reset email could not be sent.'],
    ['ko', '재설정 메일을 보내지 못했습니다.'],
  ])('%s: 모르는 사유 코드면 코드 대신 기본 문구를 보여준다', async (lng, fallback) => {
    const modal = await submitWith({
      status: true, email_sent: false, email_error: 'SOMETHING_NEW',
      reset_link: LINK, reset_token: 'rst_abc', expires_hours: 1,
    }, lng);
    expect(text(modal, '.ResetPassword__Error')).toBe(fallback);
    expect(text(modal, '.ResetPassword__LinkText')).toBe(LINK);
  });
});

describe('ResetPassword — SMTP 미설정', () => {
  it('사유 줄 없이 링크와 실제 만료 시간만 보여준다', async () => {
    const modal = await submitWith({
      status: true, email_sent: false, reset_link: LINK, reset_token: 'rst_abc', expires_hours: 3,
    }, 'ko');
    expect(modal.querySelector('.ResetPassword__Error')).toBeNull();
    expect(text(modal, '.ResetPassword__LinkText')).toBe(LINK);
    expect(text(modal, '.ResetPassword__Notice'))
      .toBe('이 링크를 사용자에게 전달하세요. 한 번만 사용할 수 있으며 3시간 후 만료됩니다.');
  });
});
