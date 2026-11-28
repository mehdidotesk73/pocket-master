# System Design — Architecture & Patterns

Developer-facing documentation of how the app is structured, how data flows, and design decisions.

## §1 — System Overview

This is a Vue 3 + TypeScript + Vite single-page app (SPA) that works as a progressive web app (PWA). It provides:

- **Header/footer shell** — app title, Help modal, build/version info, reload affordance, debug panel
- **Service-worker caching** — offline capability, smart update detection
- **Mobile-first UX** — responsive, touch-optimized, no hover-only interactions
- **Pure computation layer** (`src/lib/`) — reusable logic separated from UI
- **Hot reload in dev** — instant feedback on code changes
- **Netlify** — production site and a live preview on every branch/PR, one host

### Architecture Diagram

```
┌─────────────────────────────────────────┐
│           Browser (PWA)                 │
│  ┌───────────────────────────────────┐  │
│  │  Service Worker (cache, updates)  │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  App.vue (header/footer shell)    │  │
│  │  ├─ HelpModal                     │  │
│  │  ├─ DebugPanel                    │  │
│  │  ├─ UpdateAvailablePrompt         │  │
│  │  └─ <your content here>           │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  lib/ (pure functions)            │  │
│  │  ├─ Data fetch & cache            │  │
│  │  ├─ Computation logic             │  │
│  │  └─ Utilities                     │  │
│  └───────────────────────────────────┘  │
│  ┌───────────────────────────────────┐  │
│  │  External APIs (if needed)        │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

## §2 — Header/Footer Wrapper Template

This is the shell that wraps every page/tab. It provides version checking, update affordances, Help modal, and debug logging. See `src/App.vue` for the full implementation.

### Key Features

1. **Header** — app title (centered), Help button (top-right), "Update available" button (top-left when new version detected)
2. **Footer** — build ID/timestamp (clickable to expand debug log), "Reload latest" button, version status
3. **Debug panel** — collapsible log of on-screen messages (no console on mobile)
4. **Help modal** — renders markdown docs from `docs/concepts/*.md`
5. **Update detection** — background check against live origin, prompts user when new build is available

### Version Checking Logic

- **Build identity.** `vite.config.ts` resolves a build id (`VITE_BUILD_ID`, else Netlify's
  `COMMIT_REF`, else `git rev-parse --short HEAD`, else `dev`), bakes it into the bundle as
  `__BUILD_ID__`/`__BUILD_TIME__`, and emits `version.json` (`{ commit, builtAt }`) into the build
  root. Workbox doesn't precache `.json`, so that file always comes from the origin.
- **`useVersionCheck()`** (`src/lib/useVersionCheck.ts`) fetches `version.json` with `no-store` on
  mount and every 60 s, and compares its `commit` to `__BUILD_ID__`. States: `current`,
  `update-ready`, `unknown` (no answer yet, offline, or `vite dev`, which has no `version.json`).
  Fetch failures are logged only when reachability changes.
- **Footer:** `build <id> · <time>`, then `· up to date` or `· <commit> is live`.
- **Header:** "Update available" shows when the status is `update-ready`; its popover lists the
  running build and the live one.
- **"Reload latest"** checks again first. If `current`, it says "Already on the latest build ✓" and
  stops. Otherwise it calls `reloadLatest()` from `src/pwa.ts`, which unregisters the service
  worker, deletes every Cache Storage entry, and `location.replace`s with `?fresh=<ts>` (stripped
  again in `main.ts`). A polite `updateServiceWorker(true)` + reload often replays the old bundle on
  iOS, which is why the manual path is heavy-handed. It also drops any runtime caches an app adds;
  an app that caches data for offline use should delete only Workbox's precache there.
- **Background updates:** `setupPWAUpdates()` (called from `App.vue`, since `useRegisterSW` is a
  composable) registers the worker and calls `reg.update()` every 60 s. A ready worker is applied
  only when the app is quiet — see §8.

### Styling

**Looks are shared with the Markdown Lab editor** (github.com/mehdidotesk73/markdown-editor).
`src/styles/themes.css` is a copy of that repo's theme token blocks: Navy & Brass (default), Graphite
and Midnight & Champagne (dark); Porcelain and Fog (light). Update looks there and re-copy rather than
editing here. `src/lib/themes.ts` / `useTheme.ts` are copied too: `data-theme` on `<html>`, a chosen
dark and a chosen light look per device (localStorage `pocket-master:theme`), Dark/Light flips
between them, and the header's ▾ menu picks a look. `src/styles/vars.css` maps the app's tokens
onto the look's: `--accent` (interaction) = `--accent-blue`, `--pos` (money in, records line) =
`--accent-green`, `--negative` = `--danger`, `--projection` = `--accent-amber`, `--assets` =
`--alert-note`. Buttons are matte from the `--btn-*` tokens (kept 44px tall for phones). Display
font is Fraunces (bundled); body text is the system font. Components never use colour literals.

## §3 — Storage (device-local files, OPFS)

No network data. Everything lives in the Origin Private File System of the production origin.

```
OPFS root
├── index.<seq>.json            manifest: schemaVersion + each file's current {id, ext, rev, size, updatedAt}
├── files/
│   ├── records/<YYYY-MM-DDTHH-MM-SS>.<rev>.json   one BalanceRecord per moment
│   ├── projections/<id>.<rev>.json one ProjectionFile per projection
│   └── template.<rev>.json         TemplateFile
└── tmp/                        scratch, emptied on start
```

- **Stored data is exactly three kinds of file**, by store id: `records/<YYYY-MM-DDTHH-MM-SS>`,
  `projections/<id>`, `template`. Every '/' in an id is a real folder; each part is URL-encoded with '.' escaped (the dot
  separates name, revision and extension). Totals, averages and the projection are computed in the
  app and never stored. Which projection is on screen is a per-device preference in localStorage.
- **Store schema 2** (`STORE_SCHEMA`); `MIGRATIONS[1]` moves schema-1 flat names
  (`files/records%2F<date>.<rev>.json`) into folders, and is safe to re-run after a crash.
- **App-data migration** (`useTracker.ts` `loadFrom`): the v0.2 combined `settings` file and the
  v0.3–v0.5 single `projection` file each become `projections/everything` (+ `template`) and are
  deleted; "set it myself" figures become monthly items; `normalizeProjection` / `normalizeTemplate` /
  `normalizeRecord` also accept the first version's shapes (kinds, `dir` in/out, `everyday`) and the
  prototype's (`covered`→`inRecord`, `variable`→ everyday item).
- **Safe save** (`store.ts`): write the new revision → write `index.<seq+1>.json` → delete the old
  revision and old index. On load the highest index that parses wins; unreferenced revisions, older
  indexes and `tmp/` are deleted. A killed save always leaves the last complete version. (The index is
  versioned by filename instead of rename-swapped because OPFS has no portable atomic rename.)
- **Writes** go through one promise queue in `Store`; `storeState.saveState` is `idle | saving | error`.
- **Worker** (`worker.ts`) does every OPFS op; writes use `createSyncAccessHandle()` (Safari's
  dependable path). If OPFS or the worker isn't available the app falls back to memory and shows an
  error banner saying nothing will be kept.
- **Persistence:** `navigator.storage.persist()` on start; the footer shows installed / persistent /
  **your data** (`storeState.data`: count and UTF-8 byte total of the index's current files, kept in
  step on every index write), with a warning when not installed or not persistent. The Export sheet
  also shows `estimate().quota` as "space allowed". `estimate().usage` is not shown: iOS Safari
  reported ~100 MB for ~3 KB of data (offline caches, padding).
- **Export/import** (`BackupModal` with `section: 'export' | 'import'`, opened from the side menu
  ☰ → Records → Import / Export (`components/SideMenu.vue`), and Export from Present's backup nudge):
  - *Zip file*: fflate zip of `index.json` + `<id>.<ext>` (`records/<date>.json`, `projection.json`,
    `template.json`); zips in the old `files/<flat id>.<ext>` layout still import. iOS → share sheet
    ("Save to Files"); desktop Chromium → save dialog; else download.
  - *Clipboard*: `buildTransferJSON` → one JSON document `{ app: 'pocket-master', format: 1,
    exportedAt, projections[], template, records[] }` (format 2; format 1 with a single
    `projection` still imports) (records newest first). Refused above
    `CLIPBOARD_LIMIT_BYTES` (500 KB) so a paste can't stall a phone; a few years of weekly records is
    well under. `lib/clipboard.ts` falls back to `execCommand('copy')`.
  - *Import*: a zip, a JSON file or a paste all become an `ImportBundle` (`readImport` /
    `parseImportText`, which also accepts the prototype's `{ settings, records }`), validated and
    normalized before the Merge / Replace choice. Paste uses `navigator.clipboard.readText()`
    (iOS shows its Paste bubble) and falls back to a textarea when refused.
- `localStorage` holds only UI prefs: selected tab, last export time, install-banner dismissal.

## §3b — Screens

Three tabs, **Past · Present · Future** (default Present), lifted tabs with Lucide icons in `App.vue`
(the open tab takes the page's background and border, the rail is a shade darker): `HistoryView`, `TodayView`,
`FutureView`. **Naming in the UI:** a stored `ProjectionFile` is a *forecast*; its items are
*projections*: Recurring or One-time.
Past's Averages and Rates views have **Project this** → `ProjectFromPast` (a `DockPanel`. Fixed, from
the chart: Averages → the lines left in (the donut's Total) and its window; Rates → the line and
Both / Rising / Falling. Layout: the forecast to add to, then the projection as `ProjectionPanel`
shows it — name · Linked, every · unit · starting, the locked amount box holding the fixed values
and (Rates only) the window — and `readBack` worked out in that forecast; shows the
amount now and how it's worked out; adds a linked Recurring item and offers *See it in Future*,
which `HistoryView` emits as `open-future` to `App.vue`). Explanations (each Past chart's note, the linked-amount note) sit behind `components/InfoTip.vue`, an ⓘ
button whose text takes its own line in a wrapping flex row. A linked item's type shows as a fixed
"Recurring" tag; its amount label reads "Amount each time · linked to Past".
Future's list marks linked items
"Recurring · linked to Past" with a `describeLink` line; `ProjectionPanel` shows their amount locked.
Future = forecast picker + **Edit** / **New** → `ForecastPanel`; `ForecastChart` (a one-day-wide stacked bar on
each day any projection changes the total — day-over-day differences of `project().contributions` — with
the forecast total, starting balance included, as a step line — flat between event days, vertical on
each — past records leading in); projections list + **Add** → `ProjectionPanel`
(name with the type beside it; Recurring: Every · Unit · Starting, then the amount; One-time: Amount ·
Date — with type and Unit as `WheelPicker`s (ported from the bitcoin-explorer metric
panel: one row at rest, a 3D drum overlay while touched, native scroll-snap; it changes only on
the user's own gesture, so layout scrolls can't flip it);
and a pinned, collapsed readback (one line plus a "N to check" pill; tap for the rest) from
`readBack()` in `projectionText.ts`: the projection as one sentence, what it adds up to by the
forecast's end, and a warning for a one-time date outside the forecast); `FutureView` passes the
draft's `project()` result in as `result`. Both panels are `DockPanel`s (mid-height, bottom, page stays
visible; set apart by a grab handle and a light dim over the page that doesn't take taps;
compact 36px footer buttons) editing drafts that drive the chart live; Save writes, Cancel discards. The header's ☰ (top left) opens `SideMenu`, a drawer from the left with collapsible
sections (start collapsed); Records holds the Import / Export tag buttons. Backup (export/import + storage health) is `BackupModal`, opened from the side menu
and from Present's backup nudge. The New record sheet (`RecordModal`) is a compact list: name · ±
toggle · amount · ✕, with a drag grip on the left (pointer events; a row swaps with its neighbour
once the gap it leaves exceeds the neighbour's still-visible height, i.e. past its midpoint). New
records take the latest record's row order. Negative money displays as ($1.00) everywhere
(`fmtMoney`, `fmtPlain`; fields show it only when not focused). The sign is a button because the iPhone decimal keypad has no minus key; typing a
leading `-` on a keyboard also flips it.

## §4a — History analysis (`src/lib/analysis.ts`)

Pure functions over records for the Past tab's chart card (tabs: Totals, Timeseries, Averages, Rates) (tests in `analysis.test.ts`). A line missing
from a record counts as $0 there.
- `lineSeries(records)`: each line (by `lineNames`) valued at every record → *Timeseries* (`LineChart`,
  its own legend off; toggle chips instead).
- `windowMix(records, window)`: each line's signed average over `recordsInWindow` → *Averages*
  (`DonutChart`: slices sized by |average|; its legend rows toggle lines out; the centre is the
  signed sum of the lines left in; `WindowPicker` for the window).
- `dailyCandles(records, line | LEFT_SOURCE)`: one OHLC candle per day, **by date**, from the first
  record's day to the last's. A record day closes at its last record (open = previous day's close,
  high/low include that day's records). Between record days the value moves evenly from the earlier
  day's last record to the later day's first record, so days with no record carry
  `between { from, to, perDay }`. Daily changes sum to the whole change. → *Rates*
  (`CandleChart`; record-less days drawn lighter; Rising / Falling filter hides candles without
  rescaling).
- `measurePast(records, link)`: the measure a linked projection is locked to, over `recordsInWindow`,
  of the sum of `link.lines` (`valueCents` and `dailyCandles` take a list): `average` = mean value; `rate` = Σ daily-candle changes (`close − open`) for dates in
  (first window record date, last], counting all, only rising or only falling days, ÷ the days in
  between (0 with records on one date only). `linkedAmount(item, records)` = average, or rate ×
  `periodDays(every)`, in cents. `resolveLinks(forecast, records)` returns the forecast with every
  linked amount filled in; `useTracker.projectFor`/`resolve` and `saveProjection` use it, so the
  chart, list and readback always show the current value and the stored `amount` is the last one.
Colours per line come from `colorFor(index in lineNames)`, the same in every view.

## §4 — Calculations (`src/lib/finance.ts`)

All sums in integer cents.

- **Records** (schema 3) carry `at`, a local date-time `YYYY-MM-DDTHH:MM:SS`, plus its `date` part.
  Several per day; ordered and identified by `at` (`byAt`, `upsertRecord`); all day-based math
  uses `date`. Pre-v0.7 date-only records take their savedAt local time when it's the same day,
  else noon, and their files are renamed on load (`loadFrom`). Charts place records at `atNum(at)`.
- **Records** are lists of line items `{ id, name, amount }` with a **signed** amount: positive =
  asset, negative = liability. No line kinds. (Schema 1 had kinds and card share %; `normalizeRecord`
  converts those on load, cards at their share.)
- **Sheet** (shown as Total owned / Total owed / Net equity): assets = Σ positive lines; liabilities = Σ |negative lines|; left = assets − liabilities.
- **Template** (`template.json`): the rows every new record starts with, `{ id, name, negative,
  amount? }`. The New record sheet fills amounts from the latest record by row id; *Save as template*
  replaces it with the sheet's current rows. Rows can be added/removed per record; records keep their
  own copy, so template edits never change history.
- **`scheduledCents(s0, s1)`**, window (s0, s1]: signed recurring items on their clamped day (day 31 →
  last day); `inRecord` items count once at the start of each month after s0's month; signed one-time
  items on their date.
- **Forecasts** (`ProjectionFile`, schema 4): `{ id, name, start, horizonDays, items[] }`. `start` is
  `{ mode: 'all' }` (net equity) or `{ mode: 'lines', names }`: the starting total is the sum of
  those lines in the latest record (`startValueCents`). Items (*projections*) are **plain amounts**:
  - `recurring`: `{ name, amount, every { n, unit: day|week|month|year }, start }`
    (`occursOn`: months/years use start's day, clamped to month end);
  - `oneTime`: `{ name, amount, date }`.
  A recurring item may carry `link?: PastLink` (`{ measure: 'average', lines, window }` or
  `{ measure: 'rate', lines, window, direction: both|rising|falling }`; `lines` are added up, '' = net
  equity; a single `line` from the first preview is read as `[line]`): its
  amount is then locked to `measurePast` and worked out again on every records change (see §4a).
  It's made once from Past ("Project this", `ProjectFromPast.vue`); the editor locks the amount and
  the type, leaving name / every / start. Nothing targets a line. Schema-4 files load through
  `normalizeCurrentItem` (keeps `link`; an unreadable link is dropped), not the legacy freeze path.
- **`project(proj, records, startIfEmpty = today)`** (never null): from (latest.date, starting total),
  or ($0, today) with no records, each day adds every projection that falls on it and tracks each
  one's running `contributions` (for the stacked bars), for `horizonDays` (≤ 1830).
- **Old projections** (schema ≤ 3: Average / Rate of change of a line over a window, start points,
  target lines, "in my records until paid", and every older shape) are read by `normalizeItem` into
  `LegacyItem`s and frozen by `freezeItems` (`src/lib/legacy.ts`, tests in `legacy.test.ts`): fixed
  amounts keep their amount; computed ones take the value they come to with the records loaded now
  (`evaluateRecurring`, unchanged); ones that come to $0 are dropped; each conversion is logged.
  `loadFrom` loads records **before** projections for this, and rewrites converted files once.
  Imports freeze against the import's own records.

## §5 — Composables

Vue reactive wrappers around data fetches. Example:

```typescript
// src/lib/useMyData.ts
export const useMyData = () => {
  const data = ref([])
  onMounted(async () => {
    data.value = await fetch(...)
  })
  return { data }
}
```

Use these in components to stay reactive without fetch boilerplate.

## §6 — Components

Organized by feature. Keep them thin — mostly templating, logic lives in `lib/` and composables.

```
src/components/
  HelpModal.vue      (provided)
  <FeatureA>.vue
  <FeatureB>.vue
```

## §7 — Build, Deploy & Conventions

**Local dev:** `npm run dev` (hot reload at http://localhost:5173)

**Build before commit:** `npm run build` (catches TS errors + template parse errors)

**Production and preview, both via Netlify** (see `netlify.toml`): `main` pushes build production; every other branch/PR gets its own Deploy Preview.

**PR build check:** `.github/workflows/ci.yml` runs `npm run build` on every PR — this is the `build` status check the branch ruleset requires. It doesn't deploy anything.

**Conventions:**
- Components: PascalCase, one per file
- Functions/vars: camelCase
- CSS: BEM or utility classes (avoid specificity wars)
- Types: keep in component file or `types/` folder

## §8 — PWA & Service Worker

`main.ts` bootstraps the Vue app, fonts and error capture; `App.vue` calls `setupPWAUpdates()`.

Service worker is generated by Vite + `vite-plugin-pwa` with `registerType: 'prompt'`; it precaches
js/css/html/svg/png/woff2 (fonts work offline), never `.json` (so `version.json` hits the network).

**Update flow (data-safe):** a new worker waits. `pwa.ts` applies it only when `isQuiet()` — no
pending writes and no open drafts (`markUnsaved`). Otherwise the header shows *Update available* and
the update goes in after the next save, or when the user taps it. `visibilitychange` → version check
+ `reg.update()` (iOS freezes timers in the background). `reloadLatest()` flushes the store first and
only ever clears the service worker + Cache Storage — never OPFS, IndexedDB or localStorage.
`applyUpdate()` calls `updateServiceWorker(true)`, which reloads only on the new worker's
`controlling` event; installed iOS apps often never fire it. So after ~4.5 s still on the page it
falls back to `reloadLatest()`, and its "applying" flag is always released. The header/footer button
tries a waiting worker first (`applyUpdate`), then the version check (`useVersionCheck`, 6 s timeout),
then the forced reload.

**Home Screen install:** manifest has real name/colours, `start_url`/`scope` `/`, 192/512 icons plus a
180×180 opaque `apple-touch-icon.png`; `index.html` has the `apple-mobile-web-app-*` meta tags.
Safe-area insets pad the shell, tab bar, modal header/footer and draft bars. `InstallHint.vue` shows
iOS instructions (no install prompt exists there) or a Chromium Install button, and a stronger
warning in a browser tab that already holds data.

## §9 — Glossary

- **SPA** — Single-Page App (no server-side rendering, runs entirely in the browser)
- **PWA** — Progressive Web App (works offline, installable like a native app)
- **Service Worker** — Background script that handles caching and network requests
- **Deploy Preview** — Netlify's term for a per-branch temporary deploy
- **Build ID** — Git commit SHA, shown in footer for debugging
- **Reload latest** — Force-refresh service worker cache and reload the page

---

**When you change architecture or add a major feature, update the relevant section above + the diagram.**
