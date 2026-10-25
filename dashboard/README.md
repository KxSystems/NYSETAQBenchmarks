# KX NYSE TAQ Benchmark dashboard

Static site (SvelteKit, Svelte 5, TypeScript, Observable Plot) published at https://benchmark.kx.com.

| Page | Path | Compares |
|---|---|---|
| Solution comparison | `/` | solutions, on one machine |
| Hardware comparison | `/hardware/` | machines, running one solution at the same thread count |
| Thread scaling | `/threads/` | thread counts of one solution on one machine |

The earlier `/pages/hardware/index.html` and `/pages/threadscaling/index.html` redirect to `/hardware/` and `/threads/`.
Behaviour is specified in [docs/spec.md](docs/spec.md), the data format in
[pysrc/dataJSONSchema.md](../pysrc/dataJSONSchema.md), the design tokens in [docs/tokens.md](docs/tokens.md).
The site was built as a clean-room implementation; [PROVENANCE.md](PROVENANCE.md) records how.

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

The site reads one `static/data/<size>.json` per data size, written by
[pysrc/convertToJSON.py](../pysrc/convertToJSON.py) from the benchmark's result directories. From the repository root:

```bash
uv run pysrc/convertToJSON.py ./results/inmemory/${SIZE} ./dashboard/static/data/${SIZE}.json
```

The sizes offered by the Data size filter are the files found in `static/data/` when Vite starts (`vite.config.ts`),
so a new size appears after restarting `npm run dev`; no code change is needed. The files KX publishes (`full`,
`xlarge`, `large`) are committed.

## Layout

| Path | Contents |
|---|---|
| `src/lib/model/` | Pure calculations and filtering (ratios, geometric mean with penalty, wins, failures, load times, setup fallbacks), the series of each page, and `pages.ts` with the page logic. Unit-tested. |
| `src/lib/state/` | `View` (everything in the URL), the URL codec, the per-page canonical views, the `App` state class, the shared tooltip. |
| `src/lib/data/` | Types, `fetch` loader and schema check. |
| `src/lib/config/` | One `PageConfig` per page: title, intro, resource links and the filter panels that differ. |
| `src/lib/components/` | Filters, charts, tables, layout. |
| `src/lib/content/` | mdsvex text (intros, methodology notes). |
| `tests/e2e/` | Playwright smoke tests. |

## How the pages share one comparison

The calculations, charts and tables only see a `Resolved` comparison: `Series[]` (id, label, style, measurements,
optional tooltip and sort key), failed series, the baseline and the ordering. A page supplies a `PageLogic`
(`src/lib/model/pages.ts`) that builds it:

| | Series | Series id | Order | Colours | Memory |
|---|---|---|---|---|---|
| Solutions | solutions, one run each | solution name | by score | categorical, by solution | charts |
| Hardware (`src/lib/model/hardware.ts`) | machines, one run each | machine name | by score | categorical, by machine | charts |
| Threads (`src/lib/model/threads.ts`) | `(thread count, NUMA node)` pairs from every run on the machine | `64@0`, `128@all` | ascending thread count | sequential scale | note per run |

To add a page: write its resolver and canonical view, a `PageLogic`, a `PageConfig` in `src/lib/config/pages.ts`
(with its filter panels) and a route. The URL parameters of each page are the `View` fields it uses; parameters equal
to the page defaults are omitted.

## Deployment

[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) in the repository root checks, tests, builds and
deploys `dashboard/build/` to GitHub Pages on pushes to `main` (the repository's Pages source must be set to
"GitHub Actions"). `static/CNAME` holds the custom domain.
