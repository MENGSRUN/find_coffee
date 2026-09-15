"""Application configuration; environment variables override the local .env file."""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

STATIC = Path(__file__).parents[1] / "static"


@dataclass(frozen=True)
class Settings:
    database_url: str | None = field(default=None, repr=False)
    ors_api_key: str = field(default="", repr=False)

    @classmethod
    def load(cls) -> "Settings":
        load_dotenv(Path.cwd() / ".env")
        return cls(os.getenv("DATABASE_URL"), os.getenv("ORS_API_KEY", ""))
