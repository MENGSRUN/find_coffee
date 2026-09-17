"""Protect the service/model boundary from HTTP and concrete adapters."""

import ast
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2] / "app"


@pytest.mark.parametrize("layer", ["entity", "service", "model/projection"])
def test_inner_layers_do_not_import_frameworks_or_adapters(layer):
    paths = list((ROOT / layer).glob("*.py"))
    assert paths
    forbidden = (
        "fastapi",
        "pydantic",
        "psycopg",
        "app.controller",
        "app.config",
        "app.security",
        "app.clients",
        "find_coffee",
        "app.repository.place_repository",
    )
    for path in paths:
        for node in ast.walk(ast.parse(path.read_text())):
            modules = (
                [node.module or ""]
                if isinstance(node, ast.ImportFrom)
                else ([alias.name for alias in node.names] if isinstance(node, ast.Import) else [])
            )
            for module in modules:
                assert not any(
                    module == prefix or module.startswith(prefix + ".") for prefix in forbidden
                ), (path, module)
