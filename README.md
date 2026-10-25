# KX NYSE TAQ Benchmark dashboard

Static site (SvelteKit, Svelte 5, TypeScript, Observable Plot) published at https://benchmark.kx.com.
Behaviour is specified in `inputs/spec.md`, the data format in `inputs/schema.md`, the design tokens in `inputs/tokens.md`.

```bash
npm ci
npm run dev          # development server
npm run check        # svelte-check / TypeScript
npm test             # Vitest unit tests
npm run build        # prerender to ./build
npm run preview      # serve ./build
npm run test:e2e     # Playwright smoke tests (builds and serves the site itself)
```

Run `npx playwright install chromium` once before the end-to-end tests.

## Data

`static/data/<size>.json` (`full`, `xlarge`, `large`) are copies of `inputs/data/`. To publish new results, replace
those files; to add a data size, add the file and append its name to `SIZES` in `src/lib/data/load.ts`.

## Layout

| Path | Contents |
|---|---|
| `src/lib/model/` | Pure calculations and filtering (ratios, geometric mean with penalty, wins, failures, load times, setup fallbacks). Unit-tested. |
| `src/lib/state/` | `View` (everything in the URL), the URL codec, the `App` state class, the shared tooltip. |
| `src/lib/data/` | Types, `fetch` loader and schema check. |
| `src/lib/config/` | What a compared *series* is: the solution comparison is the only configuration so far. |
| `src/lib/components/` | Filters, charts, tables, layout. |
| `src/lib/content/` | mdsvex text (intro, methodology notes). |
| `tests/e2e/` | Playwright smoke tests. |

The later hardware and thread-scaling pages are meant to be a second and third `ComparisonConfig` plus a different
series resolver and filter panels; the calculations, charts and tables only see `Series[]`.

## Deployment

`.github/workflows/deploy.yml` checks, tests, builds and deploys `build/` to GitHub Pages on pushes to `main`.
`static/CNAME` holds the custom domain.
