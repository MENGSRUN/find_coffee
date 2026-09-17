"""Application errors, independent of HTTP."""


class SearchNotConfigured(Exception):
    pass


class CafeNotFound(Exception):
    pass


class RoutingError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status
