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

## Docs

(Documentation gaps, missing help content, outdated instructions)

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
