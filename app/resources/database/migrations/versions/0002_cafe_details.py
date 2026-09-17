"""Add optional café address, hours, and contact details."""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade():
    for table in ("coffee_shops", "coffee_shop_import"):
        for column in ("address", "opening_hours", "phone", "website"):
            op.execute(f"ALTER TABLE public.{table} ADD COLUMN IF NOT EXISTS {column} TEXT")


def downgrade():
    raise RuntimeError(
        "Downgrading would delete café details; export them before a manual rollback."
    )
