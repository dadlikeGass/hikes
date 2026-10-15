"""${message}

修订：${up_revision}
上一版：${down_revision | comma,n}
创建时间：${create_date}

写完请在本文件顶部保留一句中文说明：这次改了什么、为什么、验收怎么跑。
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
