# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Navigation: Manage vs Settings

The sidebar's **Manage** menu holds day-to-day records only: Sports & Courts, Coaches,
Users, Invoices and Discount Coupons. Everything that *configures* the academy lives
under **Settings** (admin only) and nowhere else: Team & Roles, Membership Plans,
Payments, Notifications and Integrations. Each is a Settings section, not a separate
view, so there is one way to reach it.

Settings sections are declared in `src/settings/settingsNav.ts`. The open section is held
in `Shell` (`App.tsx`) so the header search can deep-link into one: `navigate('settings',
sectionId)`. Header search indexes every Settings section as well as the pages.

## Layout conventions

- **Settings** screens are full-width. Each section gets a page header from
  `SettingsPage` (icon, title, description) and builds its body from `SettingsPanel`
  (`src/settings/SettingsPanel.tsx`) rather than a narrow centred card. Add a section's
  title and description to `SECTION_COPY` in `SettingsPage.tsx`.
- **Bookings** is a table only. Clicking a row opens that booking's own full-width page
  (customer, booking, payment, membership) with a breadcrumb back; Esc also returns.

- **Appearance** (Settings) edits the academy's three brand colours, saved through
  `PATCH /settings` (the API accepts only `#RRGGBB`). The same colours style invoice and
  receipt emails; `src/theme/BrandTheme.tsx` also maps the accent to the dashboard's
  `--color-lime` token. Stock colours apply nothing, so an academy that never opens the
  page sees no change. Settings rows (label left, control right) use `SettingsRow`.
- **Sports & Courts** (Manage) is API-backed. The list is a table of the academy's sports with
  *Add sport* (a dropdown of the stock catalogue, or *Other* with a name and an uploaded
  image). Opening a sport shows its page: **Courts** (add, remove, enable/disable; click a
  court to set its booking hours, rates, photos and facilities), **Facility** (description,
  cover photo, gallery) and **Pricing**. New courts get the default 6 AM – 10 PM hours.
  Court hours are `HH:MM` half-hour choices; midnight is `00:00`, never `24:00`.
- **Branch switcher** (sidebar, under the academy name). An admin of an academy with more than
  one branch can view one branch or *All branches*; the choice is remembered per browser
  (`ActiveBranchProvider`). It filters courts, bookings and the dashboard's booking-based
  figures client-side via `select` in `api/hooks.ts`, so switching needs no refetch. Anyone who
  cannot switch, or a single-branch academy, sees the branch name without the menu. Server-side
  KPI/revenue reports and invoice lists are not branch-filtered yet.
- **New Booking** has two views, switched with the 1 / 2 toggle above the stepper (remembered per
  browser): **1 · Step by step** (sport and court, then day and time) and **2 · One page**
  (`booking/steps/SelectSlot.tsx`: sport chips, court list, day strip and slots together, with a
  summary bar pinned to the bottom; it opens with the first sport and court selected). The draft
  survives a switch. Free hours come from `GET /courts/availability` via `useCourtAvailability`
  (the court's own hours, live bookings and holds), refetched each minute and after a booking.
  Sports are drawn with Hugeicons glyphs picked by name in `facility/sportIcons.ts` (Dance, which has
  no glyph, gets a music note; anything unmatched gets a generic sport icon) — a sport's uploaded
  photo is still used in the Sports & Courts screens.
- **A booking is at most 6 hours.** You pick a slot length (1, 2 or 3 hr) and then back-to-back
  slots of that length — up to 6 × 1 hr, 3 × 2 hr or 2 × 3 hr (`booking/slotPicker.ts`). The API
  enforces the same ceiling (`MAX_BOOKING_MINUTES` = 360), so it holds for every caller.
