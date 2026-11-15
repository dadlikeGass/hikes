"""发信：SMTP 走环境变量；没配置就把验证码写进日志（本地/灰度可用）。"""
import logging
import os
import smtplib
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import parseaddr


def configured() -> bool:
    return bool(os.getenv("SMTP_HOST", "").strip())


def send(to: str, subject: str, body: str) -> bool:
    """返回是否真的发出去了。未配置 SMTP 时只写日志，仍返回 False。"""
    host = os.getenv("SMTP_HOST", "").strip()
    if not host:
        logging.warning("[mail] SMTP 未配置，验证码只记录日志｜to=%s｜%s｜%s", to, subject, body)
        return False
    port = int(os.getenv("SMTP_PORT", "465"))
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASS", "").strip()
    sender = os.getenv("SMTP_FROM", user or "no-reply@dcyy.world").strip()
    msg = EmailMessage()
    display, address = parseaddr(sender)
    msg["From"] = (Address(display_name=display, addr_spec=address) if display and address
                   else (address or sender))
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, timeout=10) as smtp:
                if user:
                    smtp.login(user, password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=10) as smtp:
                smtp.starttls()
                if user:
                    smtp.login(user, password)
                smtp.send_message(msg)
        return True
    except Exception:  # noqa: BLE001
        logging.exception("[mail] 发送失败 to=%s", to)
        return False
