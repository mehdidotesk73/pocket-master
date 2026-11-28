# TODO — Project Backlog

Track feature development, improvements, and known issues here. Move completed work to **Done**, queue new ideas under **Next**, and record blockers in **Blocked**.

## Done

- **Budget tracker v0.1.0** — all four tabs, OPFS storage with safe saves, export/import (zip and
  prototype JSON), install hint, data-safe updates, unit tests in CI. See `docs/experience.md`.
- **v0.2.0 — signed line items + template** — `RecordModal` is a compact list (± toggle, add/remove
  rows, *Save as template* → `saveTemplate`); `sheet()` sorts by sign; `normalizeSettings` /
  `normalizeRecord` migrate schema 1; tabs Past/Present/Future; `BackupModal` replaces Setup.
- **v0.3.0 — files + averaged projection items** — data is `records/<date>.json` + `projection.json`
  + `template.json` (store `MIGRATIONS[1]`, settings split in `loadFrom`); `evaluateAveraged` (rate /
  amount over a date range, manual override) feeds `project`; `AveragedEditor`, `SignedMoneyInput`.
- **v0.4.0 — editor looks** — `styles/themes.css`, `lib/themes.ts`, `lib/useTheme.ts` copied from
  markdown-editor; app tokens mapped in `styles/vars.css`; look switcher in the `App.vue` header.
- **v0.5.0 — clipboard export/import** — `buildTransferJSON` / `parseImportText` in `useTracker.ts`,
  `lib/clipboard.ts`, `BackupModal` Export (zip / clipboard) and Import (file / paste) sections.
- **v0.6.0 — multiple projections** — `projections/<id>` files, `StartLines`, item union with
  `RecordRange` and `extrapolate`; `FutureView`, `ItemModal`, `ProjectionModal`, `SheetModal`.
- **v0.6.1 — side menu** — `components/SideMenu.vue` (☰ → Records → Import / Export).
- **v0.6.2 — quieter ± and new default rows** — `defaultTemplate`, `isPreviousDefault` in `loadFrom`.
- **v0.6.3 — drag reorder + (negatives)** — `RecordModal` grip/pointer drag, `fmtMoney`/`fmtPlain`/`parseMoney`.
- **v0.9.0 — recurring rework** — `Recurring { value, every, start }`, `occursOn`, `evaluateRecurring`,
  `recordsInWindow` (+ lastRecords), `normalizeItem` migration, `ProjectionPanel` sections.
- **v0.8.0 — forecasts & projections UI** — `FutureView`, `ForecastChart`, `ForecastPanel`,
  `ProjectionPanel`, `LensCarousel`, `DockPanel`; `project().contributions`.
- **v0.12.0 — Past chart: net equity line, owned/owed dots** — `ChartSeries.line: false` (dots only)
  in `LineChart`; `HistoryView` series.
- **v0.10.0 — projections change a line** — optional `target` on items (`targetOf`, `NET_ONLY`);
  `project()` returns `lines` (per line, day by day) + `netOnly`; `forecastLineNames`,
  `forecastSheetOn`; *Changes* select in `ProjectionPanel`; `→ line` in `summarize`. Editor readback
  (`readBack`, `DockPanel` summary slot) with warnings; Average monthly by default, no net equity;
  "income and spending combined" label (`isCombinedDrift`); step-line forecast.
- **v0.7.0 — timestamped records** — `BalanceRecord.at`, `recordId(at)`, `normalizeRecord`/`loadFrom`
  migration, `RecordModal` `editing` prop, Past rows open records.

## Next (Current Sprint)

One-time setup — tick these off as they're done:

- [x] Connect Netlify (finish-setup) — required; gives previews AND the production site
- [x] Protect `main` (finish-setup) — required; this is what makes changes arrive as PRs with
      preview links, instead of going straight to the live site

- [ ] Custom domain on Netlify **before** installing on a phone for real use (the data belongs to the
      origin; changing it later means exporting and re-importing)
- [ ] On-device check: storage spec §7 / app spec §9 items that need a real iPhone — persists across
      force-quit and reboot, `persisted()` true in the installed app, safe areas, export → reinstall →
      import
- [ ] Import data from the prototype artifact (ask Claude to produce the `{ settings, records }` JSON)

## Code

(Features, refactoring, technical debt)

Forecasts (direction agreed 2026-11-27): analysis lives in Past; Future holds only amounts typed in.

- [x] **Past analysis charts** (v0.14.0) — `lib/analysis.ts` (`lineSeries`, `windowMix`,
      `dailyCandles`); Timeseries / Averages (donut) / Rates (daily candles) tabs; `DonutChart`,
      `CandleChart`, `WindowPicker`.
- [x] **Plain-amount projections** (v0.15.0) — recurring `{ name, amount, every, start }` and
      one-time `{ name, amount, date }`, schema 4; computed / target-line / in-record projections
      frozen once into amounts (`lib/legacy.ts` `freezeItems`).
- [x] **Reorder projections** (v0.15.1) — drag by the grip or arrow keys in `FutureView`; saved
      as the forecast's item order.
- [ ] **Projections linked live to Past** (next, design agreed 2026-11-28): not a new type — a
      **Recurring** projection (name, start, every N unit as usual) whose **amount is locked** to a
      live measure from Past, e.g. "Amex · daily rate · past 90 days" or "Capital One · average ·
      past 90 days", recomputed from records whenever they change. Its card says in one line what
      it's doing (e.g. *Every day: Amex's average daily change over the past 90 days (−$32.10)*).
      One-way and not editable: delete it and set up another to change it. Plain typed amounts stay
      as they are. Open: where it's created (suggested: "Project this" on the Past chart).
- [ ] ~~Monthly in / spent / net change in Past~~ — not convinced it's needed (user, 2026-11-28);
      parked.
- [x] Mock-data page: default forecast set up from the user's own layout (paychecks, card
      projections, rent, rounded).
- Dropped: "Use as projection" (no link from Past to projections, by design); card payoff as a
  transfer and the per-line balance sheet on a date (PR #9, closed) — both needed projections tied
  to lines.

## Docs

(Documentation gaps, missing help content, outdated instructions)

- [x] **CLAUDE.md refresh** (v0.15.2) — describes the three tabs, plain-amount forecasts and the
      current file map; Help → About and system-design §3b stale projection text fixed.

## UI / UX

(Design improvements, accessibility, mobile issues)

## DevOps / Build

(CI/CD, deployment, build process improvements)

## Known Issues

(Bugs, edge cases, platform-specific quirks)

## Ideas / Backlog (Low Priority)

- Per-row share % for split cards (dropped in v0.2.0; for now enter your part as the amount)
- Edit the template outside the New record sheet (e.g. reorder rows)
- Cross-device sync (optional linked-folder backup: remoteStorage.js / Drive `drive.file` / Dropbox PKCE)
- Category-level expense logging; CSV export of records; editing a past record in place
- Single-file export/import
