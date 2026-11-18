"""The data directory: where it may live, how it is created and the one-process-per-directory lock."""

from __future__ import annotations

import os
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_ROOT.parent.parent
LOCK_NAME = 'hq-social.lock'


class DataDirError(Exception):
    """The configured data directory is refused."""


class LockError(Exception):
    """Another process holds the data directory."""


def inspect_data_path(path: Path) -> tuple[str | None, str | None]:
    """``(refusal, warning)`` for a resolved data path. Touches nothing on disk."""
    if path == SERVICE_ROOT or SERVICE_ROOT in path.parents:
        return 'The data directory must not be inside services/social.', None
    if REPO_ROOT in path.parents:
        return None, (f'Warning: {path} is inside the HQ repository; keep Social data outside the '
                      'source tree so it is never committed.')
    return None, None


def prepare_data_dir(path: str | os.PathLike[str]) -> tuple[Path, str | None]:
    """Resolve and create (mode 0700, parent must exist) the data directory. Returns it and any warning."""
    resolved = Path(path).expanduser().resolve()
    refusal, warning = inspect_data_path(resolved)
    if refusal:
        raise DataDirError(refusal)
    if resolved.exists():
        if not resolved.is_dir():
            raise DataDirError(f'{resolved} is not a directory.')
    else:
        if not resolved.parent.is_dir():
            raise DataDirError(f'The parent directory {resolved.parent} does not exist.')
        resolved.mkdir(mode=0o700)
    return resolved, warning


class DataLock:
    """An exclusive ``flock`` on ``<data>/hq-social.lock``, released when the process exits."""

    def __init__(self, descriptor: int):
        self._descriptor: int | None = descriptor

    def release(self) -> None:
        if self._descriptor is not None:
            os.close(self._descriptor)
            self._descriptor = None


def acquire_lock(directory: Path) -> DataLock:
    try:
        import fcntl
    except ImportError:
        raise LockError('This platform has no file locking, so the service cannot guarantee one process '
                        'per data directory.') from None
    descriptor = os.open(directory / LOCK_NAME, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(descriptor)
        raise LockError(f'Another HQ Social service is already using {directory}.') from None
    os.ftruncate(descriptor, 0)
    os.write(descriptor, f'{os.getpid()}\n'.encode())
    return DataLock(descriptor)
