"""Shared one-based pagination calculations."""


def total_pages(total: int, page_size: int | None) -> int:
    if page_size is None:
        return int(total > 0)
    return (total + page_size - 1) // page_size
