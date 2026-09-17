# Alembic migrations

From the project root, activate the virtual environment and run `alembic upgrade head`.
`DATABASE_URL` is read from the environment or .env; credentials are never stored
in alembic.ini. Revision 0001 creates the initial schema or adopts the existing
project schema without deleting café records. Independently modified schemas need
separate review. The initial destructive downgrade is blocked.

Use `alembic current` to inspect the revision. New schema changes should be added as
new hand-written revisions in this directory's `versions/` folder. Root `alembic.ini`
points here. `python -m scripts.data init-db` also applies these migrations.

Schema definitions belong only in migration revisions; `../queries/` contains data
operations and examples. Python records in `app/entity/` do not create tables.
See [PROJECT_STRUCTURE.md](../../../../docs/PROJECT_STRUCTURE.md) for setup and test details.
