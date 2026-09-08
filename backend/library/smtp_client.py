"""
SMTP 이메일 발송 유틸리티
DB에 저장된 SMTP 설정을 받아 이메일 발송
"""
import asyncio
import smtplib
import logging
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from concurrent.futures import ThreadPoolExecutor

from library import messages

logger = logging.getLogger("weave.smtp")
_executor = ThreadPoolExecutor(max_workers=3)


def _send_sync(config: dict, to_list: list, subject: str, body_html: str) -> dict:
    """동기 SMTP 발송"""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        sender_name = config.get("sender_name", "")
        sender_email = config["sender_email"]
        msg["From"] = f"{sender_name} <{sender_email}>" if sender_name else sender_email
        msg["To"] = ", ".join(to_list)
        msg.attach(MIMEText(body_html, "html", "utf-8"))

        with smtplib.SMTP(config["smtp_host"], config["smtp_port"]) as server:
            if config.get("use_tls", True):
                server.starttls()
            server.login(config["smtp_user"], config["smtp_password"])
            server.sendmail(sender_email, to_list, msg.as_string())

        return {"status": True, "message": "Email sent successfully"}
    except Exception as e:
        logger.error("SMTP send failed: %s", e)
        return {"status": False, "message": str(e)}


async def send_email(config: dict, to_list: list, subject: str, body_html: str) -> dict:
    """비동기 이메일 발송"""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _send_sync, config, to_list, subject, body_html)


_SHELL = ('<div style="max-width:480px;margin:0 auto;'
          'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;padding:32px;">'
          '{content}</div>')


def email_shell(content: str) -> str:
    """이메일 공용 바깥 셸. 문구는 호출부가 수신자 locale로 렌더해 넘긴다."""
    return _SHELL.format(content=content)


async def send_test_email(config: dict, to_email: str, locale: str = 'en') -> dict:
    """테스트 이메일 발송 — 문구는 요청한 관리자의 언어로 렌더한다."""
    subject = messages.render(locale, 'email.smtpTest.subject')
    body = email_shell(
        f'<h2 style="color:#5E6AD2;margin-bottom:16px;">'
        f'{messages.render(locale, "email.smtpTest.heading")}</h2>'
        f'<p style="color:#333;line-height:1.6;">'
        f'{messages.render(locale, "email.smtpTest.body")}</p>'
        '<hr style="border:none;border-top:1px solid #E5E5E5;margin:24px 0;">'
        f'<p style="color:#999;font-size:12px;">'
        f'{messages.render(locale, "email.smtpTest.footer")}</p>'
    )
    return await send_email(config, [to_email], subject, body)
