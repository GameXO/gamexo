"""Branches: the physical sites an academy trades from."""

from __future__ import annotations

from sqlalchemy import Boolean, CheckConstraint, Index, String, Text, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import TenantScoped


class Branch(TenantScoped):
    """One physical turf. An academy has at least one and may have many.

    Everything that is *located* hangs off this: a court belongs to exactly one
    branch, a booking inherits its branch from its court, and an invoice prints the
    branch it was raised at rather than the academy's head-office details.

    The academy's own `tenant_settings` row stays the home of the legal entity —
    business name, logo, brand colours, default GSTIN. A branch only carries what
    differs from site to site: where it is, how to reach it, and optionally its own
    GSTIN (a business registered in several states holds one per state, and the
    number on a tax invoice has to be the one for the state the supply was made in).

    Never deleted, only deactivated. Courts and years of bookings point here, and an
    invoice for a branch that no longer exists is an invoice nobody can reprint.
    """

    __tablename__ = "branch"
    __table_args__ = (
        # Case-insensitive, so "Kondapur" and "kondapur" cannot both exist — the
        # POS shows names in a picker and two that read the same are a mis-click
        # waiting to happen.
        Index("uq_branch_tenant_name", "tenant_id", text("lower(name)"), unique=True),
        # Exactly one default per academy, enforced by Postgres rather than by
        # whoever remembers to un-flag the old one. The default is what a court or
        # booking falls back to when nothing says otherwise.
        Index(
            "uq_branch_tenant_default",
            "tenant_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
        CheckConstraint("char_length(name) > 0", name="name_not_blank"),
    )

    name: Mapped[str] = mapped_column(String(150), nullable=False)
    #: Street address as it should print on an invoice. Free text — Indian
    #: addresses do not decompose into a tidy line1/line2 without losing landmarks.
    address: Mapped[str | None] = mapped_column(Text)
    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(120))
    pincode: Mapped[str | None] = mapped_column(String(12))
    phone: Mapped[str | None] = mapped_column(String(32))
    email: Mapped[str | None] = mapped_column(String(320))
    #: NULL means "use the academy's GSTIN from settings" — see
    #: service.effective_gstin.
    gstin: Mapped[str | None] = mapped_column(String(20))

    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    def __repr__(self) -> str:
        return f"<Branch {self.name}>"
