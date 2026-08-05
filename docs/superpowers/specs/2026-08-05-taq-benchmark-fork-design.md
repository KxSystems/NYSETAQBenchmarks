# Design — a vendor-neutral fork of the KX NYSE TAQ benchmark

**Date:** 2026-08-05
**Repo:** `peachq-org/NYSETAQBenchmarks`, forked from `KxSystems/NYSETAQBenchmarks` at `a316c8b`
**Supersedes:** `2026-08-05-taq-benchmark-fork-brief.md` (kept for history; two of its
diagnoses are corrected below)

---

## 1. Purpose

KX publishes a good in-memory TAQ benchmark and a dashboard at benchmark.kx.com. It has
exactly one path for outside engines — "add a Python executor class" — and one external
vendor PR in its history, still open. The fork exists to make the same suite a venue that
any engine can enter on equal terms, while staying close enough to upstream that results
remain comparable and every fix stays individually offerable back to KX.

Three goals, in order:

1. Any vendor can add an engine, against a written contract, without a maintainer's
   permission or a bespoke runner.
2. openq/peachq runs the benchmark, as the first consumer of that contract.
3. A run is reproducible by a stranger — pinned engine releases, recorded hardware, and
   later a one-command cloud run.

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Neutral branding, hosted at `peachq-org` | Cheapest credible neutrality; revisit if outside vendors arrive and the org name deters them |
| D2 | `main` is the fork line; upstream merged in periodically via an `upstream` remote | Contributors land on a `main` that has the fork's features; `FORK.md` keeps it honest |
| D3 | Clean room binds the maintainer, not contributors | Never run kdb+/KDB-X here; contributors holding a licence may submit kdb-run results. Stated in `CONTRIBUTING.md` |
| D4 | Engines are benchmarked from **published release artifacts**, pinned by version + sha256 | A local working copy is neither reproducible nor above suspicion. This is the credibility mechanism and the basis of goal 3 |
| D5 | A q-compatible engine runs the **unmodified** `artifacts/queries/inmemory/kdb.psv` | The point is that a q implementation runs the same q. Failures are recorded as data, not hidden — and peachq already versions itself by q-conformance score (`v0.71` = its pass rate), so the failure list is the same quantity its release number tracks |
| D6 | DuckDB changes are minimal-binding-fix only | `duckv2` will be a separate query set later; touching working queries now would read as tuning our own venue |
| D7 | Every fix to a shared file is a standalone commit, offered to KX, outcome recorded | "Stay very very close" is enforced by commit discipline, not intention |
| D8 | Submodule pin bumped in Phase 0; submodule vendored in Phase 2 | Bumping is corrective and offerable; vendoring is a permanent divergence and must not be bundled into a PR we want KX to accept |

Non-goals for Phases 0–2: `duckv2`; a general multi-implementation conformance programme;
a universal shell-out runner host; any change to the timing protocol or result schema.

## 3. Findings this design is built on

All verified in this repo at `a316c8b` with the submodule at its committed SHA.

**F1 — The submodule pin is 8 commits stale, and that is the root cause of several
apparently unrelated defects.** `.gitmodules` points at `KxSystems/taq`; the gitlink records
`ecf6daa` (`1.3.1-6-gecf6daa`) while upstream taq is at `dcfc9c6`. Consequences at HEAD as
committed:

- `scripts/util.sh`'s `get_letters` has no `tiny` and no `xlarge` — both die with
  `Unknown SIZE`. README's QuickStart opens with `export SIZE=tiny`, so the documented
  quickstart fails at Step 3, and `results/inmemory/xlarge/` is published for a size that
  cannot be generated.
- `small`/`medium`/`large` resolve to `Z-Z`/`I-I`/`A-H` at the pin, against the README's
  documented `X-Z`/`T-Z`/`P-Z`. Different data, same name.
- Test data lives in `testdata/` dated `20250701` at the pin, and in `test/data/` dated
  `20260401` upstream. `test/inmemory.sh` uses `test/data` **and** `TESTDBDATE=20260401`.

The README table and the published results are self-consistent with **upstream** taq, so KX
ran a checkout ahead of the SHA they committed. Bumping the gitlink is therefore corrective,
not a change to what the benchmark measures.

> **Correction to the brief.** Its §4 step 4.2 diagnoses this as a wrong path in
> `test/inmemory.sh` and prescribes changing `test/data` → `testdata`. That fix would point
> a `20260401` run at `20250701` files, build an empty database, and yield a vacuously green
> smoke test — the same false-pass trap the brief itself warns about in §5. The fix is the
> gitlink.

**F2 — DuckDB fails idx 24–29 in KX's own published results.** Every DuckDB solution in
`results/inmemory/large/` and `results/inmemory/xlarge/` records `status=error` for all six,
at `engineversion: 1.5.4`, live on the dashboard. `sql.psv` has no query at idx 24
(`status=emptyquery`), so KDB-X SQL does not cover them either. Six of 84 queries have had
no working DuckDB answer, in public, for months.

Root cause is exactly what the brief diagnoses: the CTE aliases the bucket `minute`, so
`GROUP BY time` cannot bind. Reproduced on DuckDB 1.5.5 against the real column type —
`duckdb_con.py:92` rewrites `quote.time` to `make_timestamp_ns(...)`, so it is `TIMESTAMP_NS`,
and `time_bucket` binds against it without complaint:

```
Binder Error: Referenced column "time" not found in FROM clause!
Candidate bindings: "minute"
```

The fix is a pure rename, `time` → `minute`, in the `GROUP BY` (idx 24–27) and additionally in
the `SELECT`, `EXCLUDE` and both `ORDER BY` clauses (idx 28–29). `time_bucket` is not touched.
`minute` is the correct surviving name, not `time`: `querymeta.psv` records `sortby: minute`
for all six, and the q sibling's `by 10 xbar time.minute` produces a column called `minute`.

Verified only to *bind and pivot*, on a synthetic table with the real `TIMESTAMP_NS` type —
**not** yet verified to match the q answer. Establishing equivalence against the row-aligned
`kdb.psv` sibling is part of the Phase 0 commit, not a given.

The dependency is pinned `duckdb>=1.4` — unpinned — so these numbers are not reproducible
across time regardless. Pinning it — to the exact version the idx 24–29 fix is verified
against, in both `pysrc/queryrunner/main.py`'s PEP 723 block and `pyproject.toml` — is a
second small upstream fix.

**F3 — The engine contract exists but is unwritten, and is now implemented three times.**
`run_solution` in `benchmarks/inmemory/common.sh:180` appends `-result`, `-tableStatsDir` and
`-queryOutputDir` to whatever command an engine arm names. Every engine must then produce: a
`-result` PSV with identical columns in identical order (`solution|storagebackend|compparam|
threadcount|runner|engine|format|indexon|idx|query|status|run1timeNS|run2timeNS|run3timeNS|
run3memKB|run1ioKB|run2ioKB|run3ioKB|ressizeKB`); setup rows at `idx` `0`/`-1`/`-2`/`-3`;
three runs per query with `$FLUSH` before the cold one; `stats.yaml` carrying `proprietary`,
`engineversion` and `sortcols`; kdb+-loadable `queryoutput_<idx>.csv`. `src/runQueries.q` and
`pysrc/queryrunner/main.py` implement it; PR #14's `runRayforce.sh` implements it a third
time; the openq harness sidestepped it and implemented a fourth. **Nothing validates any of
them.**

**F4 — README documentation drift.** README §*Adding a New Python-Based In-Memory Query
Engine* step 5 refers to `add_nickname`, renamed to `add_solution_name`; step 6 and line 483
repeat the `external/kx/taq/test/data` path from F1.

**F5 — `KxSystems/taq` is Apache-2.0**, byte-identical to this repo's LICENSE, with no
`NOTICE` and no copyright headers. Vendoring it under §4 is permitted, keeping the license
text and stating changes.

## 4. Architecture

### 4.1 Write down the contract that already exists

**`docs/engine-contract.md`** states the contract from F3 once, derived from the two existing
runners: the CLI an engine runner must accept, the artifacts it must emit, the PSV schema,
the setup-row protocol, the timing protocol, and the filter semantics (`-idx`/`-tags`/
`-instrument`, plus the mandatory abort on an idx mismatch against `querymeta.psv` or a
missing `instrument`). A vendor reads this instead of reverse-engineering `common.sh`.

### 4.2 A conformance checker

A checker validates any engine's `results.psv`, `stats.yaml` and query outputs against the
contract. This is what makes outside engines safe to accept: a PR that drifts the column set
fails mechanically instead of silently breaking `pysrc/convertToJSFormat.py`. It is also the
missing half of correctness — `src/compareOutput.q` checks *answers*, nothing checks *shape*.

### 4.3 Three documented paths, two reference implementations

| engine kind | path |
|---|---|
| library (duckdb, polars, pandas, chdb) | Python executor class behind `pysrc/queryrunner/main.py` — exists, documented, unchanged |
| q implementation (openq/peachq, any other q) | `src/qengine/runQueries.lite.q`, selected by `--engines qlite`, binary named by `QBIN`, running the unmodified `kdb.psv` (D5) |
| other native engine (rayforce, …) | own runner speaking `docs/engine-contract.md`; rayforce is the worked example |

`runQueries.lite.q` reproduces `src/runQueries.q`'s PSV-driven loop and output contract minus
the kdb-only telemetry (`.Q.gc`, `.Q.MAP`, `-s` secondary threads, IO stats). Telemetry it
cannot collect is written `nyi`, as `pysrc/queryrunner/main.py:241` already does — never a
fabricated zero. It documents its **capability floor**: exactly which q features an
implementation must support to run it. That list is the artefact other q implementations
actually want.

**Rejected: a universal shell-out host.** Spawning a process per query would put startup
inside the measurement and break cold/warm residency. An external engine owns its process for
the whole run — which is what PR #14 and the openq harness independently converged on.

### 4.4 Engine provenance (D4)

`scripts/fetch-engines.sh` downloads each engine's pinned release artifact into
`external/bin/`, verifying sha256. Local dev builds become a documented override, never the
default. First entries:

| engine | artifact | sha256 | publisher checksum? |
|---|---|---|---|
| rayforce `v2.5.11` | `rayforce-2.5.11-linux-x86_64.tar.gz` | `8f63ca95…1bbb8ccd` | yes, `.sha256` alongside |
| peachq `v0.71.0` | `peachq-v0.71.0-linux-x86_64.tar.gz` | `b61c58d2…37821339` | **no** |
| DuckDB | pinned exactly per F2 | via PyPI | yes |

Both tarballs verified to extract and run on 2026-08-05. peachq's ships a binary named `q`
plus `LICENSE`/`NOTICE`/`README.md`, is MIT, and answers `1+1` → `2`.

**Gap to close on the peachq side:** <https://peachq.org/download> publishes no checksums, so
the sha256 above is one we computed rather than one the publisher attests. A benchmark whose
own provenance rule is "pinned by version *and* sha256" should not have its own engine be the
one that cannot satisfy it. Publishing `.sha256` files alongside the peachq artifacts, as
rayforce already does, removes the asymmetry.

**Disclosure required.** peachq's `NOTICE` records that it is a fork of the rayforce array
engine (Anton Kundenko), and rayforce's author is also the author of upstream PR #14, the
rayforce adapter this fork merges in Phase 0. A venue claiming vendor-neutrality should state
that lineage in `FORK.md` and `CONTRIBUTING.md` rather than let it be discovered.

**Terminology, because the spec's own wording was ambiguous:** the clean-room prohibition is
on **kdb+ / KDB-X** — KX's proprietary binary — not on any executable named `q`. peachq and
openq ship a binary called `q` and running it is the entire point of the `qlite` arm. Phase 1
tooling must not confuse the two.

## 5. Phases

### Phase 0 — fork hygiene and upstream fixes

1. Push `openq-oracle-harness` (currently only in `../rayforce/references/NYSETAQBenchmarks`
   at `2741145`) to the fork; add the `upstream` remote.
2. `FORK.md`: every divergence, one row each, with the why and whether it is offerable
   upstream — plus an **upstream ledger** recording each PR offered to KX, when, and its
   outcome.
3. **Bump the submodule gitlink to `dcfc9c6`** (F1). Standalone commit; offered upstream.
4. Fix `duckdb.psv` idx 24–29 minimally (F2); pin the DuckDB version. Two standalone
   commits; both offered upstream.
5. Fix the README drift in F4. Standalone commit; offered upstream.
6. Merge PR #14 at head `240964f4b8f66f06e74d7a2f2b493b8fa24eab93`, SHA recorded in
   `FORK.md`, **verified by running rayforce from the v2.5.11 release tarball** — not from
   any local checkout (D4). FORK.md records the follow-up to move rayforce onto the contract
   in Phase 2.
7. No openq-specific code.

Order matters: the gitlink bump (3) must precede everything, because until it lands the smoke
test cannot run and no "before" state is meaningful.

### Phase 1 — the contract, the checker, and the q seam

1. `docs/engine-contract.md` (4.1) and the conformance checker (4.2).
2. `src/qengine/runQueries.lite.q` + capability floor; the `qlite` arm in
   `benchmarks/inmemory/queryEngines.sh`; `QBIN`; coverage in `test/inmemory.sh` as a **hard
   skip-with-notice** when no q binary is present — never a silent pass, or CI omits the one
   arm the fork exists for.
3. Fold `openq/` in: `runq.q` → the lite runner; `rundb.py` deleted in favour of the existing
   `duckdb_con` engine (`main.py:187`), with anything it does that `main.py` cannot moved
   into `main.py`; `compare.py` promoted beside `src/compareOutput.q` as the KDB-X-free
   comparator, keeping its per-column type inference and its counted-and-reported relative
   tolerance; `genparams.q` reconciled with `artifacts/parameters/genParameters.q` and #14's
   `src/rayforce/genParams.sh` into one parameter story; `taq.q` kept as the lite loader.
4. **Parameter invariant, asserted not assumed:** every parameterised query must return a
   non-empty result on both engines before a match is believed. `artifacts/parameters/test/`
   names instruments absent from the test data, so comparing two empty tables otherwise
   "passes" while proving nothing.
5. `CONTRIBUTING.md` and the neutral README frame (§6).
6. Regression gate: the 84-query openq-vs-DuckDB tally. Baseline **match 55 · order-only 9 ·
   mismatch 12 · missing 8**; it will move once idx 24–29 bind, and the delta must be
   explained rather than merely observed.

### Phase 2 — provenance

`scripts/fetch-engines.sh` (4.4); rayforce retrofitted from `RAYFORCE_BIN`-points-at-your-
checkout to fetched-release, and moved onto the written contract as its second consumer;
peachq pinned to a tagged release; the submodule vendored (D8, F5) with the upstream URL and
SHA recorded in `FORK.md` as a permanent non-offerable divergence.

### Phase 3 — cloud repeatability

One script: named instance type → fetch pinned engines → fetch a SIZE → run → publish
`results.psv` + `environment.yaml`. Prerequisite: `results/mappings.yaml` needs an entry for
the chosen instance's CPU model, since an unmapped CPU is a hard error in
`convertToJSFormat.py`.

## 6. The contribution story

`CONTRIBUTING.md` states three things:

- **What gets accepted** — any engine passing the conformance checker and matching on output.
  No vendor is privileged, including peachq.
- **How results get published** — pinned release artifacts, recorded hardware,
  `environment.yaml` attached. A result nobody else can reproduce does not go on the
  dashboard.
- **What a vendor may and may not tune** — you own your query file and your adapter; you do
  not touch another engine's queries, the shared parameters, or the timing protocol.

The clean-room boundary (D3) is stated here too. README gains a neutral frame at the top —
community fork, upstream credited, divergences in `FORK.md` — and its extension section grows
from one path to the three in 4.3. Everything else stays put so upstream merges stay cheap.

Phase 1 makes openq's failure list public (D5). It is peachq's own scorecard published in
peachq's own venue, and should be presented as exactly that.

## 7. Verification

Per PR: `bash -n` over touched shell scripts; `python -m py_compile` over touched Python;
`./test/inmemory.sh` before and after — meaningful only once Phase 0 step 3 lands; the
conformance checker once it exists; a `--query-output-dir` cross-engine check for any engine
change; and the query-status tally (success/error/empty per engine, before → after).

| arm | executable here |
|---|---|
| duckdb, chdb, polars, pandas | yes |
| rayforce, from the v2.5.11 release | yes |
| qlite under openq | yes |
| kdb, kdbxsql, pykx | **no — never run.** Shape-checked only: `bash -n`, argument construction, PSV column counts |

Each PR body states which arms were executed and which were shape-checked, rather than
implying more.

The clean room is structural, not merely disciplined: the KDB-X Community install that sat at
`~/q` was deleted on 2026-08-05, so no kdb+ binary is present on the development machine. The
claim is "none was available", not "one was available and went unused".

## 8. Open items

- Whether to revisit D1 (a neutral org) if an outside vendor raises the `peachq-org` host as
  a concern.
- `duckv2` scope, deferred entirely until after Phase 2.
- Whether the dashboard should distinguish "engine cannot express this query" from "engine
  got it wrong" — currently both land as `status=error`, which under D5 will matter.
