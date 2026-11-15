"""邮箱注册登录：邮箱验证状态 + 一次性验证码表

- users.email_verified_at：邮箱是否已验证
- auth_codes：邮箱验证码/重置码（只存哈希，限时限次）

Revision ID: 0025_email_auth
Revises: 0024_point_name_suggestions
"""
from alembic import op

revision = "0025_email_auth"
down_revision = "0024_point_name_suggestions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ")
    op.execute("""CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
        ON users (lower(email)) WHERE email IS NOT NULL""")
    op.execute("""CREATE TABLE IF NOT EXISTS auth_codes (
        id BIGSERIAL PRIMARY KEY,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('verify','reset')),
        code_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        consumed_at TIMESTAMPTZ,
        attempts INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )""")
    op.execute("""CREATE INDEX IF NOT EXISTS idx_auth_codes_lookup
        ON auth_codes (lower(email), purpose, created_at DESC)""")


def downgrade() -> None:
    raise RuntimeError("forward-only")
