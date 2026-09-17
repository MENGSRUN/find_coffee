"""Load database credentials from the environment, never from alembic.ini."""

from alembic import context
from psycopg.conninfo import conninfo_to_dict
from sqlalchemy import create_engine, pool
from sqlalchemy.engine import URL, make_url

from app.config.settings import Settings


def database_url():
    value = context.config.attributes.get("database_url") or Settings.load().database_url
    if not value:
        raise RuntimeError("DATABASE_URL is required for migrations")
    if value.startswith("postgres://"):
        value = "postgresql://" + value[len("postgres://") :]
    if "://" in value:
        return make_url(value).set(drivername="postgresql+psycopg")
    params = conninfo_to_dict(value)
    return URL.create(
        "postgresql+psycopg",
        username=params.pop("user", None),
        password=params.pop("password", None),
        host=params.pop("host", None),
        port=int(params.pop("port", 5432)),
        database=params.pop("dbname", None),
        query=params,
    )


def run():
    if context.is_offline_mode():
        context.configure(url=database_url(), target_metadata=None, literal_binds=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = create_engine(
        database_url(), poolclass=pool.NullPool, connect_args={"connect_timeout": 10}
    )
    try:
        with engine.connect() as connection:
            context.configure(connection=connection, target_metadata=None)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


run()
