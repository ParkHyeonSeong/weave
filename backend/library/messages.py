"""수신자 언어로 서버가 직접 렌더해야 하는 문구 — 알림 title(+Web Push)과 이메일.

화면 문구의 단일 출처는 프런트 카탈로그(frontend/library/i18n/{en,ko}.js)다. 여기 있는 것은
**서버가 수신자를 알고 있어서 서버에서 완성해야만 하는** 두 가지뿐이다:

  1) 알림 title — DB에 저장되고 Web Push 본문으로도 나간다. 수신자가 정해져 있으므로
     그 사람의 language_region.locale로 렌더한다. 동시에 notification.payload에
     {key, params}를 남기므로, 사용자가 나중에 언어를 바꾸면 프런트가 같은 키로 다시
     렌더한다(저장된 title은 구버전 행·Push용 폴백).
  2) 이메일 — 수신자가 정해진 콘텐츠다.

⚠️ notifications.* 키는 프런트 카탈로그의 notifications.messages.* 와 **1:1로 같아야 한다**.
   어긋나면 언어를 바꾼 사용자가 키 문자열을 보게 된다. backend/tests/test_server_messages.py가
   두 카탈로그를 대조한다.

파라미터는 str.format 스타일({actor})이고, 프런트는 같은 이름을 i18next 보간({{actor}})으로 쓴다.
"""

DEFAULT_LOCALE = 'en'
SUPPORTED_LOCALES = ('en', 'ko')

MESSAGES = {
    'en': {
        # -- 알림 ---------------------------------------------------------------
        'notifications.canvasCommentCreated': '{actor} commented on a page',
        'notifications.canvasCommentMention': '{actor} mentioned you in a page comment',
        'notifications.canvasCommentResolved': '{actor} resolved a comment',
        'notifications.canvasReplyCreated': '{actor} replied to a comment',
        'notifications.canvasReplyMention': '{actor} mentioned you in a comment reply',
        'notifications.canvasPageMention': '{actor} mentioned you on “{page}”',
        'notifications.taskMention': '{actor} mentioned you on {ref}',
        'notifications.taskAssigned': '{actor} assigned you to {ref}',
        'notifications.taskCommentMention': '{actor} mentioned you in a comment on {ref}',
        'notifications.taskCommentReply': '{actor} replied to your comment on {ref}',
        'notifications.taskStatusChanged': '{ref} changed status',
        'notifications.issueCreated': '{actor} opened issue “{issue}” on {displayId}',
        'notifications.issueMention': '{actor} mentioned you in issue “{issue}”',
        'notifications.issueComment': '{actor} commented on “{issue}”',
        'notifications.issueCommentMention': '{actor} mentioned you in a comment on “{issue}”',
        'notifications.issueClosed': '{actor} closed issue “{issue}”',
        'notifications.issueClosedWithComment': '{actor} closed issue “{issue}” with a comment',
        'notifications.issueReopened': '{actor} reopened issue “{issue}”',
        'notifications.issueReopenedWithComment': '{actor} reopened issue “{issue}” with a comment',
        'notifications.chatMention': '{actor} mentioned you in chat',
        # -- 채팅 Web Push (본문이 비어 있는 메시지의 폴백) ---------------------
        # 사용자가 입력한 실제 내용은 절대 번역·변형하지 않는다 — 내용이 없을 때만 쓴다.
        # 문구는 프런트의 layout.chatNotification.* 와 같아야 한다(포그라운드 알림과 같은 화면).
        'chat.sharedTask': 'Shared a task',
        'chat.sharedDocument': 'Shared a document',
        'chat.sharedIssue': 'Shared an issue',
        'chat.sharedAttachment': 'Sent an attachment',
        'chat.newMessage': 'New message',
        # -- 이메일 -------------------------------------------------------------
        'email.passwordReset.subject': 'Weave — Reset your password',
        'email.passwordReset.heading': 'Password reset',
        'email.passwordReset.body': ('An administrator started a password reset for your account. '
                                     'Use the button below to set a new password.'),
        'email.passwordReset.expiry': 'The link works once and expires in {hours} hour(s).',
        'email.passwordReset.button': 'Set a new password',
        'email.passwordReset.ignore': 'If you did not expect this, you can ignore this email.',
        'email.footer': 'Sent from Weave',
        'email.smtpTest.subject': 'Weave — SMTP test email',
        'email.smtpTest.heading': 'SMTP configuration test',
        'email.smtpTest.body': ('This is a test email from Weave. '
                                'If it arrived, your SMTP settings are working.'),
        'email.smtpTest.footer': 'Sent from Weave admin settings',
    },
    'ko': {
        # -- 알림 ---------------------------------------------------------------
        'notifications.canvasCommentCreated': '{actor}님이 페이지에 코멘트를 남겼습니다',
        'notifications.canvasCommentMention': '{actor}님이 페이지 코멘트에서 회원님을 멘션했습니다',
        'notifications.canvasCommentResolved': '{actor}님이 코멘트를 해결했습니다',
        'notifications.canvasReplyCreated': '{actor}님이 코멘트에 답글을 남겼습니다',
        'notifications.canvasReplyMention': '{actor}님이 코멘트 답글에서 회원님을 멘션했습니다',
        'notifications.canvasPageMention': '{actor}님이 “{page}”에서 회원님을 멘션했습니다',
        'notifications.taskMention': '{actor}님이 {ref}에서 회원님을 멘션했습니다',
        'notifications.taskAssigned': '{actor}님이 {ref}에 회원님을 담당자로 지정했습니다',
        'notifications.taskCommentMention': '{actor}님이 {ref} 댓글에서 회원님을 멘션했습니다',
        'notifications.taskCommentReply': '{actor}님이 {ref}에서 회원님의 댓글에 답글을 남겼습니다',
        'notifications.taskStatusChanged': '{ref} 상태가 변경되었습니다',
        'notifications.issueCreated': '{actor}님이 {displayId}에 이슈 “{issue}”를 열었습니다',
        'notifications.issueMention': '{actor}님이 이슈 “{issue}”에서 회원님을 멘션했습니다',
        'notifications.issueComment': '{actor}님이 “{issue}”에 댓글을 남겼습니다',
        'notifications.issueCommentMention': '{actor}님이 “{issue}” 댓글에서 회원님을 멘션했습니다',
        'notifications.issueClosed': '{actor}님이 이슈 “{issue}”를 닫았습니다',
        'notifications.issueClosedWithComment': '{actor}님이 댓글과 함께 이슈 “{issue}”를 닫았습니다',
        'notifications.issueReopened': '{actor}님이 이슈 “{issue}”를 다시 열었습니다',
        'notifications.issueReopenedWithComment': '{actor}님이 댓글과 함께 이슈 “{issue}”를 다시 열었습니다',
        'notifications.chatMention': '{actor}님이 채팅에서 회원님을 멘션했습니다',
        # -- 채팅 Web Push (본문이 비어 있는 메시지의 폴백) ---------------------
        'chat.sharedTask': '태스크를 공유했습니다',
        'chat.sharedDocument': '문서를 공유했습니다',
        'chat.sharedIssue': '이슈를 공유했습니다',
        'chat.sharedAttachment': '첨부를 보냈습니다',
        'chat.newMessage': '새 메시지',
        # -- 이메일 -------------------------------------------------------------
        'email.passwordReset.subject': 'Weave — 비밀번호 재설정',
        'email.passwordReset.heading': '비밀번호 재설정',
        'email.passwordReset.body': ('관리자가 회원님 계정의 비밀번호 재설정을 시작했습니다. '
                                     '아래 버튼으로 새 비밀번호를 설정하세요.'),
        'email.passwordReset.expiry': '이 링크는 한 번만 쓸 수 있고 {hours}시간 뒤 만료됩니다.',
        'email.passwordReset.button': '새 비밀번호 설정',
        'email.passwordReset.ignore': '요청한 적이 없다면 이 메일은 무시하셔도 됩니다.',
        'email.footer': 'Weave에서 보냄',
        'email.smtpTest.subject': 'Weave — SMTP 테스트 메일',
        'email.smtpTest.heading': 'SMTP 설정 테스트',
        'email.smtpTest.body': ('Weave에서 보낸 테스트 메일입니다. '
                                '이 메일이 도착했다면 SMTP 설정이 정상입니다.'),
        'email.smtpTest.footer': 'Weave 관리자 설정에서 보냄',
    },
}


def normalize_locale(locale) -> str:
    """지원 locale만 통과시킨다(그 외에는 en)."""
    return locale if locale in SUPPORTED_LOCALES else DEFAULT_LOCALE


def render(locale, key: str, **params) -> str:
    """수신자 locale로 문구를 만든다. 키가 없으면 en → 키 문자열 순으로 폴백한다."""
    table = MESSAGES.get(normalize_locale(locale), MESSAGES[DEFAULT_LOCALE])
    template = table.get(key) or MESSAGES[DEFAULT_LOCALE].get(key)
    if template is None:
        return key
    try:
        return template.format(**params)
    except (KeyError, IndexError):
        # 파라미터가 빠져도 알림 자체는 나가야 한다 — 템플릿 원문을 그대로 쓴다.
        return template
