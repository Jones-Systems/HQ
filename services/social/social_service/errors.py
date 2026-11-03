"""Errors that map to the contract's ``{"error": "<text>"}`` envelope (spec.hq-social-backend#iface.service.001)."""

from __future__ import annotations


class ApiError(Exception):
    """A request outcome with an HTTP status and the exact user-facing text."""

    status = 500

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class ValidationError(ApiError):
    status = 400


class ForbiddenError(ApiError):
    status = 403


class NotFoundError(ApiError):
    status = 404


class MethodNotAllowedError(ApiError):
    status = 405


class ConflictError(ApiError):
    status = 409
