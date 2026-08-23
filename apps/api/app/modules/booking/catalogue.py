"""The sports a turf can pick from during onboarding.

A fixed list in code rather than a table. Nothing about it is per-tenant — it is a
menu, not data an academy owns — and a table would need seeding into every fresh
database, migrating whenever a sport is added, and reconciling against the `sport`
rows it spawns. Selecting from here *creates* those rows; after that the academy's
own `sport` table is the only thing anyone reads.

The colours are the ones the frontend already renders sport chips in, so a sport
picked at onboarding looks the same in the booking flow without a second mapping.
Prices are opening suggestions in INR, meant to be edited — a turf in Kondapur and
one in Bandra do not charge the same for an hour of five-a-side.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class CatalogueSport:
    slug: str
    name: str
    icon: str
    color: str
    bg_color: str
    default_duration_min: int
    price_base: Decimal
    price_peak: Decimal
    price_weekend: Decimal


def _sport(
    slug: str,
    name: str,
    icon: str,
    color: str,
    bg_color: str,
    base: int,
    *,
    duration: int = 60,
    peak_uplift: float = 1.25,
    weekend_uplift: float = 1.4,
) -> CatalogueSport:
    """Derive peak and weekend from a base rate.

    Three hand-written numbers per sport is thirty-odd numbers nobody would keep
    consistent. The uplifts encode the actual pattern — evenings and weekends cost
    more — and every one of them is editable per court afterwards.
    """
    return CatalogueSport(
        slug=slug,
        name=name,
        icon=icon,
        color=color,
        bg_color=bg_color,
        default_duration_min=duration,
        price_base=Decimal(base),
        price_peak=Decimal(round(base * peak_uplift)),
        price_weekend=Decimal(round(base * weekend_uplift)),
    )


#: Ordered roughly by how commonly an Indian turf offers them — the picker renders
#: this order, and the first screenful should be the one most owners recognise.
SPORT_CATALOGUE: tuple[CatalogueSport, ...] = (
    _sport("turf-football", "Turf Football", "⚽", "#0F7A4A", "#E7F7EF", 1200),
    _sport("box-cricket", "Box Cricket", "🏏", "#B45309", "#FEF3E2", 1400),
    _sport("badminton", "Badminton", "🏸", "#1D4ED8", "#E8EFFE", 400),
    _sport("cricket-net", "Cricket Nets", "🎯", "#92400E", "#FDF0E3", 600),
    _sport("pickleball", "Pickleball", "🥒", "#15803D", "#E8F6EC", 500),
    _sport("tennis", "Tennis", "🎾", "#4D7C0F", "#F0F7E2", 700),
    _sport("basketball", "Basketball", "🏀", "#C2410C", "#FDEDE4", 800),
    _sport("volleyball", "Volleyball", "🏐", "#0E7490", "#E3F4F8", 600),
    _sport("table-tennis", "Table Tennis", "🏓", "#7C3AED", "#F1E9FE", 250),
    _sport("futsal", "Futsal", "🥅", "#047857", "#E4F5EF", 1000),
    _sport("squash", "Squash", "🎽", "#9333EA", "#F4EAFE", 600),
    _sport("hockey", "Hockey", "🏒", "#B91C1C", "#FCE9E9", 900),
    _sport("swimming", "Swimming", "🏊", "#0369A1", "#E4F1FA", 300, duration=45),
    _sport("skating", "Skating", "🛼", "#DB2777", "#FDE9F2", 300, duration=45),
    _sport("snooker", "Snooker & Pool", "🎱", "#166534", "#E7F3EB", 350, duration=30),
    _sport("kabaddi", "Kabaddi", "🤼", "#A16207", "#FBF2DE", 800),
    _sport("throwball", "Throwball", "🤾", "#0891B2", "#E2F5F9", 600),
    _sport("boxing", "Boxing & MMA", "🥊", "#DC2626", "#FDEAEA", 500, duration=45),
    _sport("gym", "Gym", "🏋️", "#525252", "#EFEFEF", 200, duration=60),
    _sport("archery", "Archery", "🏹", "#65A30D", "#F2F8E4", 500, duration=45),
)

BY_SLUG: dict[str, CatalogueSport] = {sport.slug: sport for sport in SPORT_CATALOGUE}


def as_dicts() -> list[dict[str, object]]:
    """The catalogue in the shape the API returns and `Sport(**...)` accepts."""
    return [asdict(sport) for sport in SPORT_CATALOGUE]
