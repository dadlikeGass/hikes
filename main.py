"""Vercel FastAPI entrypoint.

The application package lives under server/app and imports as ``app.*``.
Put ``server`` first on sys.path so that resolves to server/app rather than
the frontend ``app/`` directory at the repository root.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "server"))

from app.main import app  # noqa: E402,F401
