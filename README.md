# Ledgerful

A personal balance-sheet tracker that turns the records you keep into insight. Whenever you like, save
a **record**: your bank balances, savings, cards (your share) and bills, each as a signed amount.
They add up to **net equity**. Your latest record is the live position; earlier ones are history.

Single user, everything stays on your device, no accounts. Install it to your Home Screen.

## Tabs

- **Past**: charts of your records (Totals, Timeseries, Averages, Rates), the records table, and
  **Project this** to turn a measure of your records into a forecast projection that keeps up with them.
- **Present**: your latest balance sheet and **+ New record**.
- **Future**: forecasts built from projections, recurring or one-time amounts, some linked to Past.
- **☰ menu**: Records → Export / Import (zip file or clipboard).

## Live site

- Production: https://ledgerful.netlify.app
- Previews: every pull request gets its own Netlify Deploy Preview. **Don't enter real data on a
  preview.** Each preview URL has its own separate, empty storage.

## Developing

See `CLAUDE.md` and `docs/system-design.md`. `npm run build` type-checks and builds; `npm test` runs
the unit tests.
