"""管理者認証（環境変数BKM_ADMIN_PASSWORDとのBearer照合）。"""
from __future__ import annotations

import secrets
from typing import Optional

from fastapi import Header, HTTPException

from .settings import ADMIN_PASSWORD


def check_admin_password(password: str) -> bool:
    if not ADMIN_PASSWORD:
        return False
    return secrets.compare_digest(password, ADMIN_PASSWORD)


def verify_admin_authorization(authorization: Optional[str]):
    """Authorizationヘッダを検証し、不正ならHTTPExceptionを送出する。"""
    if not ADMIN_PASSWORD:
        raise HTTPException(
            status_code=403,
            detail="管理者パスワードが未設定のため、この操作は無効化されています"
                   "（環境変数BKM_ADMIN_PASSWORDを設定してください）。")
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="管理者認証が必要です。")
    if not check_admin_password(authorization.removeprefix("Bearer ")):
        raise HTTPException(status_code=401, detail="管理者パスワードが違います。")


def require_admin(authorization: Optional[str] = Header(default=None)):
    verify_admin_authorization(authorization)
