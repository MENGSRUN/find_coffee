from unittest.mock import Mock

import pytest

from app.repository.place_repository import nearest
from scripts.data import main


def test_migration_failure_does_not_expose_connection_details(monkeypatch, capsys):
    from sqlalchemy.exc import OperationalError

    monkeypatch.setenv("DATABASE_URL", "unused")
    monkeypatch.setattr(
        "scripts.data.init_db",
        Mock(side_effect=OperationalError("secret connection string", {}, Exception("secret"))),
    )
    assert main(["init-db"]) == 1
    output = capsys.readouterr().err
    assert "Schema setup failed" in output
    assert "secret" not in output


def test_missing_database_setting_is_actionable(tmp_path, monkeypatch, capsys):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert main(["init-db"]) == 1
    assert "Set DATABASE_URL" in capsys.readouterr().err


def test_empty_search_is_valid_json(monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", "unused")
    monkeypatch.setattr("scripts.data.nearest", Mock(return_value=[]))
    assert main(["nearest", "--lat", "11.5", "--lon", "104.9", "--json"]) == 0
    assert capsys.readouterr().out.strip() == "[]"


def test_invalid_file_does_not_start_an_import(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", "unused")
    path = tmp_path / "bad.csv"
    path.write_text("wrong,headers\n1,2\n")
    ingest = Mock()
    monkeypatch.setattr("scripts.data.import_cafes", ingest)
    assert main(["import-data", str(path)]) == 1
    ingest.assert_not_called()
    assert "CSV must contain" in capsys.readouterr().err


@pytest.mark.parametrize(
    "kwargs",
    [
        {"latitude": float("nan")},
        {"longitude": 181},
        {"limit": 0},
        {"limit": 101},
        {"radius_m": 0},
        {"radius_m": -1},
        {"radius_m": float("inf")},
    ],
)
def test_invalid_search_fails_before_database_connection(monkeypatch, kwargs):
    connect = Mock()
    monkeypatch.setattr("app.config.database.psycopg.connect", connect)
    args = {"latitude": 11.5, "longitude": 104.9, **kwargs}
    with pytest.raises(ValueError):
        nearest("unused", **args)
    connect.assert_not_called()
