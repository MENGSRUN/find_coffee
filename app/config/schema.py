"""Apply the same versioned schema for CLI setup and isolated test databases."""

from pathlib import Path

from alembic import command
from alembic.config import Config


def init_db(dsn: str) -> None:
    config = Config()
    migrations = Path(__file__).resolve().parents[1] / "resources" / "database" / "migrations"
    config.set_main_option("script_location", str(migrations))
    # Attributes avoid INI interpolation of passwords and changing process-wide settings.
    config.attributes["database_url"] = dsn
    command.upgrade(config, "head")
