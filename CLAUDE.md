# CLAUDE.md

Guidance for any Claude session working in this repo. Read this first. The
repeatable procedures live in `.claude/skills/` — `finish-setup` for one-time
setup, `ship-feature` for every change after that.

## If someone asks to start a *different* app here

This section stays after setup strips the bootstrap — it exists for exactly that moment.

If the user asks to **build a new webapp**, mentions the template repo, or pastes the template's
setup prompt into a session open on this project: **they are starting a new project, not changing
this one.** Don't answer from this repo. Fetch
https://github.com/mehdidotesk73/claude-nocode-netlify-webapp-workflow — read its `CLAUDE.md` and
follow those setup instructions, which begin by walking them through creating a new repository.

The tempting wrong answer is to inspect this repo, see a finished app, report that there's nothing
left to scaffold, and offer to work on *this* project instead. That reads as helpful and it answers
a question nobody asked — the request was for a new app, and this repo is simply where the session
happened to be pointing.

Never scaffold the new app into this repository.

## What this is

**Ledgerful** (renamed from Pocket Master in v0.16.2). The repo is `mehdidotesk73/ledgerful` and
the site `ledgerful.netlify.app` (both renamed from `pocket-master`). Internal ids — storage keys
`pocket-master:*`, the store's `APP_ID`, the backup format's `app: 'pocket-master'` — keep the old
name on purpose, so existing backups still import.

A Vue 3 + TypeScript + Vite single-page app (also a PWA) that **tracks a personal balance sheet**.
Whenever the user likes, they save a **record**: a dated, timed list of signed lines (bank accounts,
saving, credit cards at their share, bills due). Positive = owned, negative = owed; the sum is **net
equity**. Several records a day are fine (e.g. before and after paying a card). The latest record
is the live position, earlier ones are history, and **forecasts** project forward from plain amounts
the user types. Single user, device-local (OPFS files), no accounts, no network calls for data.

Three tabs, **Past · Present · Future** (default Present):

- **Present** (`TodayView`) — figure row, the latest balance sheet, **+ New record** / **Edit
  latest** (`RecordModal`: rows prefilled from the latest record, ± toggle, drag to reorder, date +
  time, "Save as template"), and a backup nudge after two weeks without an export.
- **Past** (`HistoryView`) — one chart card with four views: **Totals** (net equity line, owned /
  owed dots), **Timeseries** (every line, tap to hide), **Averages** (donut of each line's average
  over a `WindowPicker` window, tap a line to leave it out), **Rates** (one candle per day, by date,
  from `dailyCandles`). Then the records table; tap a record to edit or delete it.
- **Future** (`FutureView`) — pick a **forecast** (a stored `ProjectionFile`: name, which lines of
  the latest record it starts from, days ahead), see its chart (`ForecastChart`: a bar on each day
  something happens, the running total as a step line, past records leading in), and its
  **projections**: **Recurring** (amount, start date, every N days/weeks/months/years) or
  **One-time** (amount, date), drag to reorder. Editors are `DockPanel` drafts that drive the
  chart live; nothing saves until Save. Projections are **typed amounts only** — nothing is
  computed from records (old computed ones are frozen on load by `lib/legacy.ts`), except a
  recurring projection **linked to Past** ("Project this" on Averages / Rates → `ProjectFromPast`),
  whose amount is locked to a live measure (`measurePast` / `resolveLinks` in `lib/analysis.ts`).
- **☰ menu** (`SideMenu`) → Records → **Export / Import** (`BackupModal`: zip or clipboard JSON,
  Merge or Replace).

How the calculations, storage and update flow work is written up in `docs/system-design.md`
(§3 storage, §3b screens, §4 / §4a calculations, §8 updates). Read it before changing behaviour.

The entire app is wrapped inside a header and footer. The header provides the app title, a Help button that opens the conceptual-docs modal, and an "Update available" affordance that surfaces when a newer PWA build is live. The footer provides the current build id/timestamp, version-check status against the live origin, a "Reload latest" button to force-refresh a stale cache, and a collapsible debug log with copy-to-clipboard support. See `docs/system-design.md` §2 for the full wrapper template and implementation details.

The user previews on a **phone** (mobile Safari), so favour mobile-friendly layouts and remember there's no dev console on device — see Debugging below.

## Getting Started

**Setup not finished?** Check the checklist under **Next** in `docs/TODO.md`. If
anything there is unticked, run the **`finish-setup`** skill — it's resumable and
does only what's outstanding.

**Ready to build?** Every change goes through **`ship-feature`**. See below.

## Development lifecycle

Every change — feature, fix, or tweak — goes through the **`ship-feature`** skill
(`.claude/skills/ship-feature/SKILL.md`): branch off `main`, build before each
commit, push, wait for the Netlify preview, run the pre-merge doc gate, open the
PR, hand the user preview + live + merge links, then watch the production deploy
after they merge.

Two rules that hold regardless:

- **Never work on `main`.** It's protected; pushes are rejected. If you find
  yourself on it, branch before doing anything.
- **The user merges, not you.** They can't merge what they can't find, so a PR
  turn always ends with the links.

**The skills in `.claude/skills/` are a copy, not a subscription.** This project
was scaffolded from a template by file copy, so fixes made to that template since
never arrive on their own. The **`update-skills`** skill pulls them in. Worth
offering when a step in setup or shipping goes wrong in a way that sounds like a
known bug — but don't run it mid-feature; it's housekeeping, not a fix for
whatever they're actually asking about.

## Build & verify

- **Type-check + build:** `npm run build` (runs `vue-tsc -b && vite build`).
  This is the gate — it catches TS errors _and_ Vue template parse errors.
  **Run it before every commit.** A broken build has reached history before
  because nothing ran it; don't let that happen.
- **CI runs the same build on every PR** (`.github/workflows/ci.yml`, check name `build`), and the
  branch ruleset requires it to pass before merge. That's a backstop, not a substitute: run
  `npm run build` locally before pushing rather than letting CI find it — a red check on the user's
  PR is noise they have to interpret.
- **Tests are added when a feature earns them, not up front.** The scaffold ships with no runner;
  `ship-feature` step 4 assesses whether a change adds logic later features will sit on, and sets
  up `vitest` the first time the answer is yes. Until then a passing build is the bar.
- **If tests exist, they run inside the `build` job** — one `npm test` line in
  `.github/workflows/ci.yml`, never a separate job. The ruleset requires a check named `build`; a
  second job called `test` would fail without blocking anything, since the ruleset isn't watching
  it.
- **Tests:** `npm test` (Vitest). `src/lib/*.test.ts` cover the calculations (records, schedules,
  forecast, Past analysis, legacy freezing); `src/lib/storage/store.test.ts` covers safe-save, crash
  recovery and export/import on the memory backend; `src/features/tracker/*.test.ts` cover loading
  old data and import bundles. CI runs them inside the `build` job. Any change to `finance.ts`,
  `analysis.ts` or the store needs a test.
- **No external data** — the app is self-contained. You can run it here (`npm run build && npx vite
  preview`) and drive it with Playwright; OPFS works in headless Chromium on localhost. What you
  can't reproduce is iOS Safari's storage behaviour (eviction, install containers) — lean on the
  user's on-device screenshots and the footer's storage-health line for that.

## Deploys

- **Netlify does both jobs** (`netlify.toml`): pushes to `main` build the **production** site at
  `https://ledgerful.netlify.app`; every other branch/PR gets its own **Deploy Preview**
  at `deploy-preview-<n>--ledgerful.netlify.app`. One host, one build pipeline — nothing
  else to configure for hosting.
- **The production origin owns the user's data.** OPFS is per-origin: changing the domain, or
  installing from a deploy-preview URL, means an empty store. Set up a custom domain before real use,
  and never send real users a preview URL.
- **`.github/workflows/ci.yml` only runs the build check on PRs** — it doesn't deploy anything. Its
  sole job is the `build` status check the branch ruleset requires (see Build & verify).
- **`package-lock.json` is committed and must stay that way** — CI runs
  `npm ci`, which fails outright without a lockfile in sync with
  `package.json`. Commit the lockfile whenever you change dependencies.

## Repo structure

```
src/
  App.vue                  header/footer shell (see docs/system-design.md §2) + the three tabs
  main.ts, pwa.ts          bootstrap; service-worker update (prompt) + reload fallback
  debug.ts                 on-screen log: auto-captures errors + logDebug() (mobile has no console)
  env.d.ts                 ambient types: vite/client, PWA virtual module, __BUILD_ID__/__BUILD_TIME__
  styles/                  vars.css, themes.css
  lib/
    money.ts               cents helpers, currency formatting, day-number + local datetime helpers
    finance.ts             records (sheet, upsert), schedules (every N unit), windows, project()
    analysis.ts            Past charts: lineSeries, windowMix, dailyCandles
    legacy.ts              pre-v0.15 computed projections, only to freeze old files to amounts
    clipboard.ts           copy/paste with phone fallbacks
    themes.ts, useTheme.ts, useVersionCheck.ts
    *.test.ts              finance, analysis, legacy, money
    storage/
      worker.ts            OPFS file ops in a Web Worker (createSyncAccessHandle writes)
      store.ts             safe-save file store: revisions + index, queue, migrations, zip export/import
      useStore.ts          Vue side: health, export (share sheet / save dialog / download)
      store.test.ts        crash-recovery + export/import tests (memory backend)
  features/tracker/
    useTracker.ts          records / forecasts / template state, normalize + migrate, import bundles
    projectionText.ts      projection sentences, summaries, colours
    TodayView, RecordModal, BalanceSheet, FigureRow                    Present
    HistoryView, LineChart, DonutChart, CandleChart, WindowPicker      Past (hand-rolled SVG)
    FutureView, ForecastChart, ForecastPanel, ProjectionPanel, DockPanel   Future
    BackupModal, MoneyInput, SignedMoneyInput, WheelPicker
    *.test.ts              normalize/migration, projection text, export/import
  components/
    HelpModal.vue          renders docs/concepts/*.md into the Help modal (one tab per file)
    InstallHint.vue        iOS "Add to Home Screen" instructions / Chromium Install button
    SideMenu.vue           ☰ drawer (Records → Import / Export)
    InfoTip.vue            ⓘ button that shows / hides an explanation (chart notes, linked amounts)
    ProjectFromPast        (in features/tracker) the Past → linked projection panel
.claude/skills/
  finish-setup/SKILL.md    scaffold personalization + one-time hosting setup
  ship-feature/SKILL.md    the change loop: branch → build → PR → links → doc gate
  add-github-pages/SKILL.md   optional: a Netlify-independent production mirror, on request
  add-statefulness/SKILL.md  decide what kind of state an app needs, confirm it, route to the rest
  add-database/SKILL.md    Supabase setup, once add-statefulness has settled that it's needed
  update-skills/SKILL.md   pull newer skills from the template this project was copied from
  share-pattern/SKILL.md   write up a reusable lesson as one copy-pasteable block, to send upstream
docs/
  TODO.md                  living backlog (Done / Next branch / Housekeeping)
  experience.md            what didn't work + per-merge version history
  system-design.md         developer/system docs (§2 has wrapper template)
  concepts/*.md            per-page user docs (rendered into the Help modal)
public/
  favicon.svg, logo-192.png, logo-512.png   app icons
.github/workflows/ci.yml       build check on every PR (required by the branch ruleset)
netlify.toml                   preview-deploy config (Netlify)
package-lock.json              committed — CI runs `npm ci` and needs it
```

## Conventions & gotchas

- **Charts are hand-rolled SVG** (`LineChart`, `ForecastChart`, `DonutChart`, `CandleChart`), x = day
  number (or `atNum` for timed records), y = dollars. No chart library.
- **Pure logic lives in `src/lib/`** — keep new computation there and keep components thin.
- **Money is summed in integer cents** (`toCents`/`fromCents`); stored values are dollars rounded to
  cents. **Dates are local `YYYY-MM-DD` strings** (a record's `at` is a local datetime); do day
  arithmetic with `dayNum()` / `atNum()`, never `Date` objects, so time zones/DST can't shift a date.
- **Every write goes through the store** (`getStore().write/writeJSON/remove`), never OPFS directly.
  Shape change → bump `schema` and add a step in `normalizeProjection`/`normalizeRecord`/`normalizeTemplate` (app data) or
  `MIGRATIONS` in `store.ts` (on-disk layout). New builds must open old data.
- **Drafts register themselves** with `markUnsaved(key, on)`; `pwa.ts` won't apply an update while
  any draft is open or a write is pending. New editors must do the same.
- **Projections are a guide, not advice.** Keep that wording in the UI.
- **Never commit personal figures** (balances, pay) — they're entered in the app.
- **Mobile-first:** the user is on a phone. Keep controls tappable.

## Debugging on device (no console)

- **Errors are captured automatically.** `installErrorCapture(app)` in
  `main.ts` routes four sources into the on-screen log: Vue's
  `errorHandler` (throws inside event handlers, hooks and watchers — the
  "button does nothing" case), `console.error`/`console.warn`, `window.error`
  (including failed resource loads), and `unhandledrejection`. Nobody has to
  have anticipated the failure for it to be visible.
- The footer shows **View logs** with a red count badge when errors exist;
  the panel has **Copy log**, which includes build id, user agent and URL.
  **Ask for it by name** — "tap View logs, then Copy log, and paste it here"
  — rather than asking what they see. Repeated identical errors collapse to
  `×N`, so a handler firing every tap can't flush the buffer.
- `logDebug(msg, kind?)` still exists for deliberate diagnostics. When
  something's invisible on device, add a **one-shot, guarded** one (in
  `onMounted`, wrapped in try/catch) and ask for the log. Remove or quiet
  noisy logs before merge.

## Reference docs

- `.claude/skills/finish-setup/SKILL.md` — scaffold personalization + one-time hosting setup (resumable).
- `.claude/skills/ship-feature/SKILL.md` — the loop for every change.
- `.claude/skills/add-github-pages/SKILL.md` — optional Netlify-independent mirror, on request.
- `docs/TODO.md` — current backlog and what's been done.
- `docs/experience.md` — dead ends (with reasons) + version history.
- `docs/system-design.md` — developer/system documentation; §2 contains the wrapper template.
- `docs/concepts/*.md` — per-page user docs, also rendered into the Help modal.
