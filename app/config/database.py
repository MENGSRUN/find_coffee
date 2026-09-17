"""Psycopg connection setup shared by persistence adapters."""

import psycopg


def connect(dsn: str, **kwargs):
    return psycopg.connect(dsn, connect_timeout=10, **kwargs)
