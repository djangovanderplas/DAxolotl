"""Stubbed auth — single dev user.

All endpoints take ``current_user: CurrentUser = Depends(get_current_user)``
so that swapping in org SSO later is a one-file change.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class CurrentUser:
    id: int
    email: str
    name: str
    is_admin: bool


def get_current_user() -> CurrentUser:
    # TODO(post-mvp): replace with real session / org SSO.
    return CurrentUser(id=1, email="dev@local", name="Dev", is_admin=True)
