# Alembic migrations

From the project root, activate the virtual environment and run `alembic upgrade head`.
`DATABASE_URL` is read from the environment or .env; credentials are never stored
in alembic.ini. Revision 0001 creates the initial schema or adopts the existing
project schema without deleting café records. Independently modified schemas need
separate review. The initial destructive downgrade is blocked.

Use `alembic current` to inspect the revision. New schema changes should be added as
new hand-written revisions. See docs/PROJECT_STRUCTURE.md for setup and test details.
