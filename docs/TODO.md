# TODO — Project Backlog

Track feature development, improvements, and known issues here. Move completed work to **Done**, queue new ideas under **Next**, and record blockers in **Blocked**.

## Done

- **Budget tracker v0.1.0** — all four tabs, OPFS storage with safe saves, export/import (zip and
  prototype JSON), install hint, data-safe updates, unit tests in CI. See `docs/experience.md`.

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

- Light theme
- Cross-device sync (optional linked-folder backup: remoteStorage.js / Drive `drive.file` / Dropbox PKCE)
- Category-level expense logging; CSV export of records; editing a past record in place
- Single-file export/import
