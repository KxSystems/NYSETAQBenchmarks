# Provenance

Clean-room implementation of the KX NYSE TAQ benchmark dashboard. This file records,
per working session, what was built and which sources were used.

Sources allowed: `inputs/` (spec.md, schema.md, tokens.md, data/*.json) and public
documentation of the libraries used. Nothing else.

## Session 1 — 2026-10-25

**Built:** nothing yet. Read `inputs/spec.md`, `inputs/schema.md` and `inputs/tokens.md`,
and summarised the structure of `inputs/data/{full,xlarge,large}.json` (counts, solutions,
machines, run states, null fields) to inform a project proposal. No code written; waiting
for approval of the proposal.

**Sources used:** only files under `inputs/`. No public library documentation consulted yet.
Nothing was read, listed or searched outside this directory, and no other benchmark
dashboard or earlier version of this dashboard was looked at.

## Session 1 (continued) — 2026-10-25, after approval of the proposal

**Built:** the solution comparison page (spec sections 2–11, 13, 14) from the approved proposal:
data loader and types; pure model (setup fallbacks, query filters, ratios, geometric mean with penalty, wins,
failures, load times, formats, bands, colours); URL codec and canonical view; `App` state class; filter bar and
three panels; geometric-mean, failures, wins (hand-written SVG pie), memory and load-time charts; query
breakdown with sticky header/column, roving cell focus and query-text tooltips; load-time table; theme toggle;
redirects for the two earlier paths; GitHub Pages workflow; CNAME. Vitest unit tests (model, URL codec,
canonical view, token contrast, shipped data files) and Playwright smoke tests.

**Sources used:** only `inputs/`, plus public documentation of the libraries as shipped in `node_modules`
(the type definitions and sources of SvelteKit, adapter-static and Observable Plot, read to check option
names such as paint values accepted by Plot, the removal of `svelte.config.js` and `$lib` in SvelteKit 3,
and subpath imports). Package versions were looked up with `npm view`. No other benchmark dashboard and no
earlier version of this dashboard was looked at, and no code was reproduced from memory of one.

**Incident, recorded for completeness:** one command, `npx vitest run --root / <file>`, was run with the
filesystem root as the Vitest root while measuring colour contrast. Vitest searches its root for test files, so
it walked the filesystem outside this directory looking for `*.test.*` files. It produced no output beyond an
exit code, nothing from it was read or used, and it was stopped and its helper file deleted. The measurement
was redone inside the project. The directory `~/dev/nysetaqbenchmarks` was never opened or listed by any
command I ran, but this crawl could have traversed it.

## Session 2 — 2026-10-25, second release (hardware comparison and thread scaling pages)

**Built:** the two pages as configurations of the shared comparison, from `inputs/spec.md` sections 2, 4 and 12 and the
proposal approved before coding. Series construction for machines (`model/hardware.ts`) and for
`(thread count, NUMA node)` pairs (`model/threads.ts`); the pure `PageLogic` per page (`model/pages.ts`) with defaults,
status text, chips and series removal; per-page canonical views and URL parameters (`pairs`, `machines`, `solution`);
`PageConfig`s, the single-solution, hardware and thread-scaling filter panels; the sequential colour scale;
series-ordered charts and tables, the linear-scaling line, the per-run memory note and the failed-run empty state;
resource links with the current page marked; routes `/hardware/` and `/threads/`; redirects of the old `/pages/...`
paths to them. The main page keeps its behaviour; its header gains the two internal link cards that section 4 requires.
Vitest tests for the new series, labels, order, baselines, defaults, URL codec, canonical views, links and the shipped
data; Playwright smoke tests per page, themes, phone width and the redirects; README updated.

**Sources used:** only `inputs/`, this repository and the public documentation of the libraries as shipped in
`node_modules` (Observable Plot option names). No other benchmark dashboard and no earlier version of this dashboard was
looked at, and no code was reproduced from memory of one. Every tool (Vitest, Playwright, svelte-check, the build, the
preview server) ran with this directory as its root; nothing outside it was read, listed or searched.
