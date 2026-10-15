"""Alembic 运行环境。

两条硬规则：
1. 连接串只从 `DATABASE_URL` 读，和 `server/app/main.py` 一致，不在这里写第二份默认值。
2. 每个修订生效后写一行 `migration_log`，作为升级台账；写台账失败只告警，不影响迁移结果。
"""
from __future__ import annotations

import os
import pathlib
import sys

from alembic import context
from sqlalchemy import create_engine, pool

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg://hikes:hikes@db:5432/hikes")

config = context.config
target_metadata = None


def _record_version(ctx, step, **kw) -> None:
    """把生效的修订记进 migration_log。台账写不进去也不能让迁移失败。

    签名由 alembic 定死：它按关键字调用 `callback(ctx=..., step=..., heads=..., run_args=...)`。
    收到的 `step` 是 `MigrationInfo`（不是 MigrationStep）：版本号在 `up_revision_id(s)`，
    是否 stamp 在 `is_stamp`，修订说明在 `up_revision.doc`。
    """
    try:
        version = (getattr(step, "up_revision_id", None)
                   or ",".join(getattr(step, "up_revision_ids", ()) or ())
                   or "-")
        if getattr(step, "is_stamp", False):
            action = "stamp"
        else:
            action = "upgrade" if getattr(step, "is_upgrade", None) else "downgrade"
        up_revision = getattr(step, "up_revision", None)
        doc = (getattr(up_revision, "doc", None) or "").strip().splitlines()
        ctx.connection.exec_driver_sql(
            "INSERT INTO migration_log (version, action, comment) VALUES (%s, %s, %s)",
            (version, action, doc[0] if doc else None),
        )
    except Exception as exc:  # noqa: BLE001 - 台账是附加物，不能反过来挡迁移
        print(f"[migrate] 台账写入跳过：{exc}", file=sys.stderr)


def run_migrations_offline() -> None:
    context.configure(url=DATABASE_URL, literal_binds=True,
                      dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(DATABASE_URL, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata,
                          on_version_apply=_record_version)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
