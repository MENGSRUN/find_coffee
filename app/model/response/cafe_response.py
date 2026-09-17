"""Response serialization and safe application errors."""


def cafe_response(row: dict) -> dict:
    return {**row, "osm_id": str(row["osm_id"])}
