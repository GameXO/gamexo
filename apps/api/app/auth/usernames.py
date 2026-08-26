"""How a login name is built, in one place.

Every principal signs in with a username rather than an email address:

    admin@{tenant}          the owner. one per academy.
    {name}.staff@{tenant}   everyone else on the payroll.
    kiosk@{tenant}          the shared counter tablet. not a person.
    ops@gamexo              the platform operator. exactly one, across everything.

── Why not just use the email address ──────────────────────────────────────────
Two of these have no email address to be. The counter login is a device shared
between shifts, and the platform operator is a role rather than a person; inventing
mailboxes for them to authenticate with means inventing mailboxes that must then be
real enough to receive a password reset.

Usernames also make the tenant visible in the credential. Support asking "what do
you sign in with?" gets `rahul.staff@navigo-sports` and knows the academy, the
person and their level without a lookup — where `rahul@gmail.com` says nothing.

── The address is still kept ───────────────────────────────────────────────────
`app_user.email` does not go away and is not the login. It is where this account's
mail is delivered — the welcome message carrying the generated password, most
importantly — and `admin@navigo-sports` is not a deliverable address. Anything that
sends must use the email; anything that authenticates must use the username.

── On the tenant part ──────────────────────────────────────────────────────────
It is the tenant *slug*, not a domain: `admin@navigo-sports`, never
`admin@navigo-sports.com`. That is deliberate — a username that looks like a real
address invites someone to email it. There is no MX record behind it and never
will be.

Usernames are generated once, at creation, and stored. They are NOT derived from
the slug on the fly: a tenant that later changes its slug would otherwise silently
invalidate every credential its staff has written down.
"""

from __future__ import annotations

import re

#: The platform operator. One account, no tenant, hardcoded because there is
#: exactly one of it — see models/user.py::PlatformAdmin.
OPS_USERNAME = "ops@gamexo"

#: Local parts that belong to the platform, not to a person. A staff member called
#: "Admin" must not be able to claim `admin@their-turf`.
RESERVED_LOCAL_PARTS = frozenset({"admin", "kiosk", "ops", "root", "support", "system"})

_SLUG_SAFE = re.compile(r"[^a-z0-9]+")


def slugify_name(name: str) -> str:
    """"Rahul Joshi" -> "rahul-joshi". Empty input yields "staff"."""
    cleaned = _SLUG_SAFE.sub("-", name.strip().lower()).strip("-")
    return cleaned[:40] or "staff"


def for_admin(tenant_slug: str) -> str:
    return f"admin@{tenant_slug}"


def for_kiosk(tenant_slug: str) -> str:
    return f"kiosk@{tenant_slug}"


def for_staff(full_name: str, tenant_slug: str, *, suffix: int | None = None) -> str:
    """`rahul-joshi.staff@navigo-sports`, or `rahul-joshi-2.staff@…` on a clash.

    The suffix goes on the *name*, not after `.staff`, so the shape of the username
    is identical for everyone and the level is still readable at a glance.
    """
    local = slugify_name(full_name)
    if local in RESERVED_LOCAL_PARTS:
        # Somebody genuinely called "Admin". Their username must not collide with
        # the owner's, and must not look like it either.
        local = f"{local}-staff"
    if suffix is not None:
        local = f"{local}-{suffix}"
    return f"{local}.staff@{tenant_slug}"


def normalise(identifier: str) -> str:
    """Usernames are case-insensitive, like the email addresses they resemble."""
    return identifier.strip().lower()


def looks_like_email(identifier: str) -> bool:
    """Does this identifier have a dotted domain after the `@`?

    Used only to tell a legacy email login from a username at the point of lookup —
    `admin@xcourt` versus `admin@xcourtsports.com`. Not validation: an identifier
    that matches neither shape simply fails to resolve, like any wrong credential.
    """
    _, _, domain = identifier.partition("@")
    return "." in domain
