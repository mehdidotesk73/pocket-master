# Ledgerful

A personal balance-sheet tracker. On any day you save a **record** of your bank balances, credit
cards (your share), bills due, and money going out or coming in. The app adds them into one number,
**left so far**. Your latest record is the live position, earlier records are history, and the app
projects ahead from your monthly items, one-time items and everyday spending.

Single user, everything stays on your device, no accounts. Install it to your Home Screen.

## Screens

- **Today**: your latest balance sheet and key figures, and **+ New record**
- **Projection**: where left so far is heading, with a chart, everyday spending, and monthly and one-time items
- **History**: every record on a chart and in a table
- **Setup**: the lines each record asks for, plus backup (export and import)

## Live site

- Production: https://pocket-master.netlify.app (once Netlify is connected)
- Previews: every pull request gets its own Netlify Deploy Preview. **Don't enter real data on a
  preview.** Each preview URL has its own separate, empty storage.

## Development

Built with Vue 3 + TypeScript + Vite (PWA).

```
npm install
npm run dev      # local dev server
npm test         # unit tests (Vitest)
npm run build    # type-check + production build
```

## Docs

- `CLAUDE.md`: how to work on this project (start here)
- `docs/system-design.md`: architecture, storage, calculations, update flow
- `docs/concepts/`: in-app help pages
- `docs/TODO.md`: backlog
- `docs/experience.md`: lessons learned and version history
