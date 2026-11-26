# Components

Shell-level components. Feature screens live in `src/features/tracker/`.

- `HelpModal.vue` — renders `docs/concepts/*.md` into the Help modal, one tab per file
- `InstallHint.vue` — "Add to Home Screen" instructions on iOS, Install button on Chromium

Keep components thin: calculations live in `src/lib/finance.ts`, state in `useTracker.ts`.
