"""What gamexo sells, described as data.

A tuple in code rather than a table, for the same reason as the sport catalogue in
`modules/booking/catalogue.py`: this is a price list, not something any academy
owns. A table would need seeding into every fresh database and a migration every
time marketing changes a number.

Both sides read this one definition — the API prices the Razorpay order from it and
the website renders its pricing cards from `GET /signup/plans`. Changing a price is
an edit to `PLANS` below: no migration, no schema change, no frontend release.

── On the numbers ──────────────────────────────────────────────────────────────
PLACEHOLDERS. They are plausible for the Indian turf market and they are not a
commercial decision anybody has made. Replace them before the site is public.

── On paise ────────────────────────────────────────────────────────────────────
Every amount here is an integer in the smallest currency unit, because that is what
Razorpay's API takes and because ₹2,499.00 is not representable as a float. The
conversion to something a human reads happens once, in the frontend.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from app.models.tenant import PlanTier


class BillingPeriod(StrEnum):
    MONTHLY = "monthly"
    YEARLY = "yearly"


@dataclass(frozen=True, slots=True)
class Plan:
    #: The same value that lands in `Tenant.plan_tier`. Typed as the enum so a plan
    #: added here without a tier to store it in fails at import, not in production.
    code: PlanTier
    name: str
    tagline: str

    #: Per month, and per year, in paise. The yearly figure is stored rather than
    #: derived from a discount percentage: "two months free" is a marketing promise
    #: that changes independently of the monthly price, and a rounded multiplication
    #: produces prices like ₹29,988 that nobody would choose to print.
    price_monthly_paise: int
    price_yearly_paise: int

    features: tuple[str, ...]

    #: What the plan actually caps. Advisory today — nothing enforces them yet, and
    #: they are here so the pricing page and the eventual enforcement read the same
    #: numbers rather than two lists that drift.
    max_courts: int | None
    max_staff: int | None

    #: Renders the highlighted card. Exactly one plan should carry it.
    popular: bool = False

    def price_paise(self, period: BillingPeriod) -> int:
        return (
            self.price_yearly_paise
            if period is BillingPeriod.YEARLY
            else self.price_monthly_paise
        )


CURRENCY = "INR"

PLANS: tuple[Plan, ...] = (
    Plan(
        code=PlanTier.STARTER,
        name="Starter",
        tagline="One turf finding its feet. Bookings, a counter, and the numbers.",
        price_monthly_paise=2_499_00,
        price_yearly_paise=24_990_00,  # two months free
        features=(
            "Up to 4 courts",
            "Online and walk-in bookings",
            "POS counter with check-in",
            "GST invoices and receipts",
            "Daily revenue and occupancy reports",
            "Email support",
        ),
        max_courts=4,
        max_staff=5,
    ),
    Plan(
        code=PlanTier.GROWTH,
        name="Growth",
        tagline="A busy venue running memberships, an academy and a rental shop.",
        price_monthly_paise=4_999_00,
        price_yearly_paise=49_990_00,
        features=(
            "Up to 12 courts",
            "Everything in Starter",
            "Memberships and packages",
            "Academy — batches, coaches, attendance",
            "Rental shop and inventory",
            "Playo, Hudle and District listings",
            "Priority email and phone support",
        ),
        max_courts=12,
        max_staff=20,
        popular=True,
    ),
    Plan(
        code=PlanTier.PRO,
        name="Pro",
        tagline="Multi-venue operators who need the whole platform and an API.",
        price_monthly_paise=9_999_00,
        price_yearly_paise=99_990_00,
        features=(
            "Unlimited courts",
            "Everything in Growth",
            "Events and tournaments",
            "Advertising inventory",
            "Booking gateway API for your own apps",
            "Custom domain and white-label branding",
            "Dedicated account manager",
        ),
        max_courts=None,
        max_staff=None,
    ),
)

BY_CODE: dict[str, Plan] = {plan.code: plan for plan in PLANS}


def get(code: str) -> Plan | None:
    return BY_CODE.get(code.strip().lower())
