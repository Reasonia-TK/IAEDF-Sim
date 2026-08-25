"""アプリ設定（環境変数で上書き可能）。"""
from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND_DIR.parent

DATA_DIR = Path(os.environ.get("BKM_DATA_DIR", APP_DIR / "data"))
RESULTS_DIR = Path(os.environ.get("BKM_RESULTS_DIR", APP_DIR / "results"))
DB_PATH = Path(os.environ.get("BKM_DB_PATH", APP_DIR / "db" / "bkm.sqlite3"))
FRONTEND_DIR = Path(os.environ.get("BKM_FRONTEND_DIR", APP_DIR / "frontend"))

# 管理者パスワード。未設定なら削除等の管理操作は常に拒否される。
ADMIN_PASSWORD = os.environ.get("BKM_ADMIN_PASSWORD", "")

# 同時実行ジョブ数
MAX_WORKERS = int(os.environ.get("BKM_MAX_WORKERS", "2"))


def ensure_dirs():
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
