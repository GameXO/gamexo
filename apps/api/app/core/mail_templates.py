"""What the emails say.

Kept apart from `mail.py` so wording and transport change independently, and so a
template can be rendered in a test without an SMTP server anywhere near it.

Hand-built HTML rather than a template engine. These are transactional emails —
three of them, mostly tables of numbers — and mail clients are hostile enough
(Outlook ignores most CSS, Gmail strips <style> blocks) that everything has to be
inline-styled anyway. A Jinja dependency would buy nothing here.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from html import escape
from zoneinfo import ZoneInfo

from app.models.tenant import TenantSettings
from app.modules.booking.models import Booking

CURRENCY = {"INR": "₹", "USD": "$", "GBP": "£", "EUR": "€"}


def money(amount: Decimal | float | int, currency: str = "INR") -> str:
    symbol = CURRENCY.get(currency.upper(), f"{currency.upper()} ")
    return f"{symbol}{Decimal(str(amount)):,.2f}"


def local(moment: datetime, timezone_name: str) -> datetime:
    """Times are stored as instants; a customer reads them in the venue's zone.

    Sending "your court is at 14:30" when they booked 20:00 IST is the single most
    confusing thing a booking email can do.
    """
    try:
        return moment.astimezone(ZoneInfo(timezone_name))
    except Exception:  # noqa: BLE001 — a bad tz must not stop the mail going out
        return moment


def _shell(settings: TenantSettings, heading: str, intro: str, body: str, footer: str) -> str:
    """The one HTML frame every message shares, in the tenant's own colours."""
    name = escape(settings.business_name)
    contact = " · ".join(
        escape(part) for part in (settings.phone, settings.email) if part
    )
    return f"""\
<div style="margin:0;padding:24px 12px;background:{settings.brand_background};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid rgba(0,0,0,0.06);">
    <div style="background:{settings.brand_primary};padding:20px 24px;">
      <p style="margin:0;color:#ffffff;font-size:17px;font-weight:700;">{name}</p>
    </div>
    <div style="padding:24px;">
      <h1 style="margin:0 0 6px;font-size:20px;color:#111111;">{escape(heading)}</h1>
      <p style="margin:0 0 20px;font-size:14px;color:#555555;line-height:1.5;">{escape(intro)}</p>
      {body}
    </div>
    <div style="padding:16px 24px;background:#fafafa;border-top:1px solid rgba(0,0,0,0.06);">
      <p style="margin:0;font-size:12px;color:#888888;line-height:1.5;">{escape(footer)}</p>
      {f'<p style="margin:6px 0 0;font-size:12px;color:#888888;">{contact}</p>' if contact else ''}
    </div>
  </div>
</div>"""


def _rows(pairs: list[tuple[str, str]], *, emphasise_last: bool = False) -> str:
    out = []
    for i, (label, value) in enumerate(pairs):
        last = emphasise_last and i == len(pairs) - 1
        weight = "700" if last else "400"
        border = "border-top:1px solid rgba(0,0,0,0.08);" if last else ""
        out.append(
            f'<tr><td style="padding:7px 0;{border}font-size:14px;color:#555555;">{escape(label)}</td>'
            f'<td style="padding:7px 0;{border}font-size:14px;color:#111111;font-weight:{weight};'
            f'text-align:right;">{escape(value)}</td></tr>'
        )
    return f'<table style="width:100%;border-collapse:collapse;">{"".join(out)}</table>'


# ── Booking confirmation ────────────────────────────────────────────────────


def booking_confirmation(
    booking: Booking,
    settings: TenantSettings,
    *,
    court_name: str,
    sport_name: str,
) -> tuple[str, str, str]:
    """Returns (subject, text, html)."""
    starts = local(booking.starts_at, settings.timezone)
    ends = local(booking.ends_at, settings.timezone)
    cur = settings.currency

    when = f"{starts:%a %d %b %Y}, {starts:%I:%M %p} – {ends:%I:%M %p}".replace(" 0", " ")
    subject = f"Booking confirmed · {court_name} · {starts:%d %b, %I:%M %p}".replace(" 0", " ")

    lines: list[tuple[str, str]] = [
        ("Sport", sport_name),
        ("Court", court_name),
        ("When", when),
        ("Duration", f"{booking.duration_min} min"),
    ]

    charges: list[tuple[str, str]] = [("Court", money(booking.court_charge, cur))]
    for item in booking.equipment or []:
        qty = item.get("qty", 1)
        charges.append((f"{item.get('name', 'Add-on')} × {qty}", ""))
    if booking.equipment_charge:
        charges.append(("Add-ons", money(booking.equipment_charge, cur)))
    if booking.discount:
        charges.append(("Discount", f"-{money(booking.discount, cur)}"))
    charges.append(("Taxes", money(booking.taxes, cur)))
    charges.append(("Total", money(booking.total, cur)))

    balance = booking.total - booking.amount_paid
    outstanding = (
        f"{money(balance, cur)} is payable at the venue."
        if balance > 0
        else "Paid in full — nothing to settle on arrival."
    )

    text = "\n".join(
        [
            f"{settings.business_name} — booking confirmed",
            "",
            f"{sport_name} · {court_name}",
            when,
            "",
            *(f"{label}: {value}" for label, value in charges if value),
            "",
            outstanding,
            "",
            # The one line the customer needs on arrival, so it stands alone rather
            # than trailing the charges. Previously this printed booking.id — a
            # 36-character UUID that nobody could read out at a counter, let alone
            # key into a kiosk.
            f"Booking ID: {booking.reference}",
            "Show this at the counter to check in.",
        ]
    )

    html = _shell(
        settings,
        "Your court is booked",
        f"Hi {booking.customer_name or 'there'}, here are the details.",
        _rows(lines)
        + '<div style="height:18px"></div>'
        + _rows([c for c in charges if c[1]], emphasise_last=True)
        + f'<p style="margin:18px 0 0;font-size:14px;color:#111111;">{escape(outstanding)}</p>'
        # Big and monospaced because it is about to be typed into a touchscreen from
        # a phone held in the other hand.
        + '<div style="margin:22px 0 0;padding:14px;border:1px solid #e7ebf0;'
        'border-radius:10px;text-align:center;">'
        '<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;'
        'color:#8c8c8c;">Booking ID</div>'
        '<div style="margin-top:4px;font-family:monospace;font-size:22px;'
        f'font-weight:700;color:#111111;">{escape(booking.reference)}</div>'
        "</div>",
        "Type your Booking ID at the counter to check in. "
        "Please arrive a few minutes early.",
    )
    return subject, text, html


# ── Payment receipt ─────────────────────────────────────────────────────────


def payment_receipt(
    settings: TenantSettings,
    *,
    customer_name: str,
    amount: Decimal,
    method: str,
    reference: str,
    balance_remaining: Decimal | None = None,
) -> tuple[str, str, str]:
    cur = settings.currency
    subject = f"Payment received · {money(amount, cur)}"

    rows = [
        ("Amount", money(amount, cur)),
        ("Method", method.upper()),
        ("Reference", reference),
    ]
    if balance_remaining is not None and balance_remaining > 0:
        rows.append(("Still outstanding", money(balance_remaining, cur)))

    closing = (
        f"{money(balance_remaining, cur)} remains on this booking."
        if balance_remaining is not None and balance_remaining > 0
        else "This settles the balance in full. Thank you."
    )

    text = "\n".join(
        [
            f"{settings.business_name} — payment received",
            "",
            *(f"{label}: {value}" for label, value in rows),
            "",
            closing,
        ]
    )
    html = _shell(
        settings,
        "Payment received",
        f"Thanks {customer_name or 'there'} — we've recorded your payment.",
        _rows(rows, emphasise_last=False)
        + f'<p style="margin:18px 0 0;font-size:14px;color:#111111;">{escape(closing)}</p>',
        "This is a receipt for your records.",
    )
    return subject, text, html


# ── Welcome, with the credentials to sign in ────────────────────────────────


def _credential_box(label: str, username: str, password: str) -> str:
    """One boxed username/password pair.

    Monospaced, because these are about to be typed rather than read, and a
    proportional font makes l/1 and O/0 a guess.
    """
    return (
        '<div style="margin:14px 0 0;padding:14px 16px;border:1px solid #e7ebf0;'
        'border-radius:10px;background:#fafafa;">'
        '<div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;'
        f'color:#8c8c8c;">{escape(label)}</div>'
        '<div style="margin-top:8px;font-family:monospace;font-size:15px;color:#111111;">'
        f'<strong>{escape(username)}</strong></div>'
        '<div style="margin-top:4px;font-family:monospace;font-size:18px;font-weight:700;'
        f'color:#111111;letter-spacing:0.04em;">{escape(password)}</div>'
        "</div>"
    )


def welcome_credentials(
    settings: TenantSettings,
    *,
    full_name: str,
    username: str,
    password: str,
    kiosk_username: str,
    kiosk_password: str,
    dashboard_url: str,
    pos_url: str,
    plan_name: str,
    amount_paid: Decimal,
    payment_reference: str,
) -> tuple[str, str, str]:
    """The one email that carries passwords.

    Two logins, because an academy needs both from the first day: the owner's
    dashboard account, and the shared credential for the counter tablet. Sending
    them together is deliberate — the counter login discovered a week later is a
    support ticket, and the wizard has just finished asking which services the POS
    should run.

    Sending a password by email is a real weakness and it is a deliberate trade: the
    alternative — a set-your-password link — is another round trip standing between
    a customer who has just paid and the product they paid for, and a link that
    expires unread is a support ticket. What limits the damage is that these
    passwords exist nowhere else. They are generated at provisioning, hashed straight
    into `app_user`, and never written to `signup_intent`, to a log, or to an audit
    row.

    Note that the logins are **usernames, not addresses** — `admin@your-slug` has no
    mailbox behind it. See auth/usernames.py.
    """
    cur = settings.currency
    subject = f"Your {settings.business_name} dashboard is ready"

    receipt = [
        ("Plan", plan_name),
        ("Paid", money(amount_paid, cur)),
        ("Reference", payment_reference),
    ]

    text = "\n".join(
        [
            f"Welcome to gamexo, {full_name or 'there'}.",
            "",
            f"{settings.business_name} is set up and ready to take bookings.",
            "",
            "── Your admin login (full access) ──",
            f"  Sign in at : {dashboard_url}",
            f"  Username   : {username}",
            f"  Password   : {password}",
            "",
            "── Your counter login (POS only) ──",
            f"  Sign in at : {pos_url}",
            f"  Username   : {kiosk_username}",
            f"  Password   : {kiosk_password}",
            "",
            "These are usernames, not email addresses — type them exactly as shown.",
            "Change both passwords after your first sign-in — Settings → Security.",
            "",
            *(f"{label}: {value}" for label, value in receipt),
        ]
    )

    html = _shell(
        settings,
        "Your dashboard is ready",
        f"Welcome aboard, {full_name or 'there'}. {settings.business_name} is set up "
        "and ready to take bookings.",
        '<p style="margin:0 0 4px;font-size:14px;color:#111111;font-weight:600;">'
        "Your admin login — full access</p>"
        + _credential_box("Dashboard", username, password)
        + f'<p style="margin:8px 0 0;font-size:12px;color:#888888;">{escape(dashboard_url)}</p>'
        + '<div style="height:20px"></div>'
        + '<p style="margin:0 0 4px;font-size:14px;color:#111111;font-weight:600;">'
        "Your counter login — bookings and check-in only</p>"
        + _credential_box("POS tablet", kiosk_username, kiosk_password)
        + f'<p style="margin:8px 0 0;font-size:12px;color:#888888;">{escape(pos_url)}</p>'
        + '<p style="margin:18px 0 0;font-size:13px;color:#555555;line-height:1.5;">'
        "These are <strong>usernames, not email addresses</strong> — type them "
        "exactly as shown, including the part after the @.</p>"
        + f'<div style="margin:22px 0 0;"><a href="{escape(dashboard_url)}" '
        f'style="display:inline-block;background:{settings.brand_primary};color:#ffffff;'
        'text-decoration:none;padding:12px 22px;border-radius:10px;font-size:14px;'
        'font-weight:600;">Open my dashboard</a></div>'
        + '<div style="height:26px"></div>'
        + _rows(receipt, emphasise_last=False),
        "Please change both passwords after your first sign-in, under "
        "Settings → Security. If you did not sign up for gamexo, reply to this "
        "email and we will remove the account.",
    )
    return subject, text, html


# ── Invoice ─────────────────────────────────────────────────────────────────


def invoice_raised(
    settings: TenantSettings,
    *,
    invoice_no: str,
    customer_name: str,
    items: list[dict],
    subtotal: Decimal,
    gst: Decimal,
    discount: Decimal,
    total: Decimal,
    balance_due: Decimal,
) -> tuple[str, str, str]:
    cur = settings.currency
    subject = f"Invoice {invoice_no} · {money(total, cur)}"

    line_rows = [
        (f"{item.get('description', 'Item')} × {item.get('qty', 1)}", money(item.get("amount", 0), cur))
        for item in items
    ]
    totals = [("Subtotal", money(subtotal, cur))]
    if discount:
        totals.append(("Discount", f"-{money(discount, cur)}"))
    totals.append(("GST", money(gst, cur)))
    totals.append(("Total", money(total, cur)))

    closing = (
        f"{money(balance_due, cur)} is outstanding."
        if balance_due > 0
        else "Paid in full — thank you."
    )

    text = "\n".join(
        [
            f"{settings.business_name} — invoice {invoice_no}",
            "",
            *(f"{label}: {value}" for label, value in line_rows),
            "",
            *(f"{label}: {value}" for label, value in totals),
            "",
            closing,
        ]
    )
    html = _shell(
        settings,
        f"Invoice {invoice_no}",
        f"Hi {customer_name or 'there'}, here is your invoice.",
        _rows(line_rows)
        + '<div style="height:18px"></div>'
        + _rows(totals, emphasise_last=True)
        + f'<p style="margin:18px 0 0;font-size:14px;color:#111111;">{escape(closing)}</p>',
        f"Invoice {invoice_no}"
        + (f" · GST {settings.gst_number}" if settings.gst_number else ""),
    )
    return subject, text, html
