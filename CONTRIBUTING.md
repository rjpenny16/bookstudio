# Contributing to BookStudio

Thanks for helping. A few ground rules keep the project trustworthy for publishers.

## Before you open a PR

```bash
npm ci
npm run lint && npm run typecheck && npm test && npm run build
npx playwright test   # end-to-end, needs a Chromium (see README)
```

Sign off your commits (`git commit -s`). We use the [Developer Certificate of Origin](https://developercertificate.org/), not a CLA.

## Changing KDP rules

All marketplace numbers live in `src/lib/kdp/rules.ts`. When KDP changes something:

1. Update the value and bump `RULES_VERSION`.
2. Cite the KDP help page in the PR description.
3. Add or adjust a test in `tests/kdp.test.ts` or `tests/preflight.test.ts`.

## Research data connectors

Do not add code that scrapes marketplaces. A new data source must document its contractual basis, rate limits, retention and redistribution rights in a `LEGAL.md` next to the connector, and must label modelled numbers as estimates.

## Assets

Only add fonts, templates or images under OFL, CC0, CC BY, Apache-2.0 or MIT, and record the license and source. Never copy assets, templates or UI from commercial tools.
