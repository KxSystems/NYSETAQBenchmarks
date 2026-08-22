# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A benchmark suite that measures in-memory query performance over public
[NYSE TAQ](https://ftp.nyse.com/Historical%20Data%20Samples/DAILY%20TAQ/) data across
KDB-X (q-sql), KDB-X SQL, pykx, DuckDB, chDB, Polars (eager and lazy) and Pandas. It also
contains the static dashboard ([index.html](index.html)) published as GitHub Pages at
benchmark.kx.com (see [CNAME](CNAME)).

[README.md](README.md) is the canonical user-facing documentation and stays authoritative —
when this file or [.claude/skills/run-nyse-taq-benchmarks/SKILL.md](.claude/skills/run-nyse-taq-benchmarks/SKILL.md)
disagrees with it, re-read the README. Keep all three in sync when changing behaviour.

## Commands

All scripts assume the **repository root** as CWD (they reference `./src`, `./artifacts`,
`./external` relatively; `iostat.py` shells out to `./src/resolve_device.sh`).

```bash
# One-time: the download scripts and shared bash helpers live in the taq submodule
git submodule update --init --recursive
```

### Test

There is a single end-to-end smoke test — no unit-test framework, no linter config:

```bash
./test/inmemory.sh
```

It builds a tiny kdb+ and Parquet DB from the submodule's test PSVs
(`external/kx/taq/test/data`, no download needed), runs **both** benchmark drivers with
`artifacts/parameters/test`, and regenerates a dashboard JS file. It only asserts the pipeline
runs; it checks nothing about the numbers. Run it after touching any runner, driver, query file
or parser.

### Full pipeline

```bash
export SIZE=tiny                       # tiny|small|medium|large|xlarge|full (see README Step 1)
export NYSEBENCHMARKDIR=$PWD/DATA
export DATADATE=20260401               # this changes as NYSE publishes new data

./external/kx/taq/scripts/getPSVs.sh --csvdir ${NYSEBENCHMARKDIR}/${SIZE}/psv --dates ${DATADATE} --size ${SIZE}

DATAFORMAT=kdb ./generateDB.sh ${NYSEBENCHMARKDIR}/${SIZE}/psv ${NYSEBENCHMARKDIR}/${SIZE}/kdb ${DATADATE}
SYMBOLSTOREDAS=ROWGROUP DATAFORMAT=parquet ./generateDB.sh ${NYSEBENCHMARKDIR}/${SIZE}/psv ${NYSEBENCHMARKDIR}/${SIZE}/parquet/rowgroup ${DATADATE}

./benchmarks/inmemory/queryEngines.sh --db-dir ${NYSEBENCHMARKDIR}/${SIZE} \
  --param-dir ./artifacts/parameters/${SIZE} --datadate ${DATADATE} \
  --threads "4 16" --result-dir ./results/inmemory/${SIZE}/$(date +%Y%m%d_%H%M)
```

`generateDB.sh` reads `SIZE` (mapped to a letter range by the submodule's `get_letters`),
`DATAFORMAT` and `SYMBOLSTOREDAS` from the environment; `--db-dir` is the **per-size**
directory — the drivers append `kdb` / `parquet/rowgroup` themselves.

### Narrowing a run while iterating

Full sweeps take hours; almost all development uses a subset:

```bash
./benchmarks/inmemory/queryEngines.sh --db-dir ... --param-dir ... --datadate ... \
  --threads "4" --engines kdb,duckdb --solutions "KDB-X,DuckDB (Index)" --idx 40-44
```

`--idx` accepts `42`, `32,42,50` or `40-44`. `--engines` picks engines; `--solutions` picks the
named variants within them (`"ALL"` runs every variant). Non-selected queries appear in the
output as `idxfiltered` / `tagfiltered` / `instrumentfiltered` rows rather than being dropped.

A single runner can also be invoked directly, which is the fastest debug loop (note `FLUSH`
is mandatory for both runners):

```bash
FLUSH=./flush/noflush.sh q ./src/runQueries.q -db ${NYSEBENCHMARKDIR}/${SIZE}/kdb \
  -storage_backend memory -date ${DATADATE} -paramdir ./artifacts/parameters/${SIZE} \
  -queryfile ./artifacts/queries/inmemory/kdb.psv \
  -querymeta ./artifacts/queries/inmemory/querymeta.psv -sortcols time -indexon sym -idx 42 -debug

FLUSH=./flush/noflush.sh uv run pysrc/queryrunner/main.py -db ${NYSEBENCHMARKDIR}/${SIZE}/parquet/rowgroup \
  -storage_backend memory -engine duckdb_con -date ${DATADATE} \
  -paramdir ./artifacts/parameters/${SIZE} -queryfile ./artifacts/queries/inmemory/duckdb.psv \
  -querymeta ./artifacts/queries/inmemory/querymeta.psv -sortcols time -indexon sym -idx 42
```

Both accept `-help` (q) / `--help` (Python).

### Supporting tools

```bash
# Cross-engine output equivalence (see README "Verifying Query Output Correctness")
./benchmarks/inmemory/queryEngines.sh ... --query-output-dir ./results/inmemory/output
q src/compareOutput.q -querymeta ./artifacts/queries/inmemory/querymeta.psv \
  -queryoutput1 ./results/inmemory/output/KDB-X -queryoutput2 ./results/inmemory/output/DuckDB_Index_

# Regenerate dashboard data for a size (also refreshes querymeta.generated.js)
uv run pysrc/convertToJSFormat.py ./results/inmemory/${SIZE} ./results/inmemory/${SIZE}/data.generated.js

# Query parameter files for a new SIZE
q artifacts/parameters/genParameters.q -db ${NYSEBENCHMARKDIR}/${SIZE}/kdb -dst ./artifacts/parameters/${SIZE}

# Renumber the idx column after inserting a query mid-file
./artifacts/queries/reindex.sh artifacts/queries/inmemory/*.psv
```

## Architecture

### Four-stage pipeline

`getPSVs.sh` (submodule) → parser (`src/taqToKDB.q` for kdb+, `pysrc/taqToParquet/` for
Hive-partitioned Parquet, both behind `generateDB.sh`) → benchmark driver → merged
`results.psv` → optional dashboard JS. Each stage's output is the next stage's input on disk;
data lives outside the repo tree under `$NYSEBENCHMARKDIR`.

### Two runners that must stay behaviour-compatible

This is the single most important structural fact. The same benchmark semantics are
implemented twice:

* [src/runQueries.q](src/runQueries.q) — KDB-X engines (`q-sql`, `SQL`) and the table-dict
  formats.
* [pysrc/queryrunner/main.py](pysrc/queryrunner/main.py) — Python engines, dispatching to a
  per-engine class in [pysrc/queryrunner/executors/inmemory/](pysrc/queryrunner/executors/inmemory/).
  `-storage_backend memory` is the only backend it implements; the `executors/ondisk/` tree is
  gone, so `disk` (still in the `-storage_backend` `choices`) raises.

Where one engine is benchmarked in several configurations, the executors are a base class plus
thin subclasses: `chdb_base.py` → `chdb.py` / `chdb_pyarrow.py`, and `polars_base.py` →
`polars_eager.py` / `polars_lazy_streaming.py`. `polars_base.py` owns `load_resources`, the
setup rows, `get_table_stats` and `write_csv`, and defers the API-specific steps to `_scan`,
`_transform`, `_sort`, `_frame` and `_collect`: the eager subclass is `DataFrame`s throughout,
the lazy one hands queries `LazyFrame`s and collects with `engine="streaming"` (the sort
deliberately stays on the in-memory engine). Both keep `self._tables` as `DataFrame`s, since
that is what the reported sizes and schemas are read from. `main.py` picks between them on
`-mode eager|lazy`, which is **mandatory** for `-engine polars`.

Both must: load `exnames`/`master`/`trade`/`quote` into memory then transform → sort → index
(emitting setup rows with `idx` `0`/`-1`/`-2`/`-3`); run every query 3× (cold, warm, warm) with
`$FLUSH` invoked before the cold run; emit the **same PSV columns in the same order**; honour
the same `-idx` / `-tags` / `-instrument` filter semantics; and **abort** on an idx mismatch
against `querymeta.psv` or a missing/invalid `instrument` value. A change to timing, column
set, or filtering in one runner must be mirrored in the other, or results stop being comparable
and `convertToJSFormat.py` breaks.

### "Solution" is a driver-level concept

A *solution* is an engine plus a specific sort/index/query-file combination — `KDB-X`,
`KDB-X (Parted)`, `KDB-X (NoAttr)`, `DuckDB (Index)`, `Polars (Eager)`, `Polars (Lazy)`,
`KDB-X (Table Dict Peach)`, … The runners know nothing about it: they only receive
`-sortcols`, `-indexon`, `-format`, `-queryfile`, `-mode` (Polars) and (for the table-dict
variants) `EACHPEACH`. The driver scripts are the
registry of solutions, and [benchmarks/inmemory/common.sh](benchmarks/inmemory/common.sh)
`run_solution` / `add_solution_name` prepends the `solution` column to each per-solution PSV
afterwards. To add or rename a solution, edit the driver — and remember `index.html` and
`results/mappings.yaml` refer to solutions by these exact display names.

`common.sh` also owns everything shared by both drivers: `init_benchmark` (validates
`DATADATE`, sets `FLUSH=flush/noflush.sh` since in-memory runs need no cache flush, creates the
scratch dir removed on exit), `save_environment` (the `environment.yaml` hardware snapshot),
NUMA pinning via `NUMANODE`, `merge_results`, and `check_table_stats` (warns when solutions
report different row/column counts — i.e. loaded different data, so their timings are not
comparable). Each driver supplies only `usage()`, argument parsing and `execute_queries()`,
then calls `init_benchmark` and `run_suite`.

### Query set and parameters are cross-file invariants

Queries are stored **per engine** in `artifacts/queries/inmemory/*.psv`, row-aligned by `idx`
with the engine-independent `querymeta.psv` — one file **per solution variant** where the
syntax differs, so Polars has both `polars.psv` (eager) and `polars_lazy.psv`, which are
identical except that the six `pivot` queries (idx 24–29) insert a `.collect()` first because
`pivot` has no `LazyFrame` equivalent. A query added to one of the pair must be added to the
other. In `querymeta.psv`, `instrument` and `complexity` drive the dashboard filters, and
`instrument` is mandatory. Query parameters come from
`artifacts/parameters/<SIZE>/*.txt` and are loaded independently by `load_parameters`
(Python) and [src/getQueryParameters.q](src/getQueryParameters.q) — a new parameter needs a
`.txt` in **every** size directory plus both loaders. README's *Extending the Benchmarks*
section is the detailed procedure; follow it rather than improvising.

### Results layout and the dashboard

Per-solution PSVs go to a scratch `<result-dir>/tmp`, merged into `<result-dir>/results.psv`.
Alongside it: `environment.yaml` (host/CPU/memory snapshot, plus the "test date" used to order
runs) and `<solution>/{stats.yaml,os.txt}` (per-table stats incl. `proprietary`/`engineversion`/
`sortcols`, and `/usr/bin/time -v` output).

[pysrc/convertToJSFormat.py](pysrc/convertToJSFormat.py) turns a tree of such run directories
into one `data.generated.js` (ClickBench-style), keyed by
`(datadate, machine, solution, numanode)` and merging thread counts across runs, keeping the
latest per key. `numanode` is the run's `NUMANODE` (`"all"` when it was empty, i.e. unpinned)
and belongs in the key: a pinned and an unpinned run see different core counts, so their thread
counts must not merge into one entry. Machine names come from the CPU
model → name map in [results/mappings.yaml](results/mappings.yaml); an unmapped CPU is a hard
error, so a new benchmark host needs an entry there. `index.html` picks its data file from
`available_sizes` / `?size=` and falls back to the generated `querymeta.generated.js` copy when
opened over `file://`.

The dashboard is three pages over one engine: [assets/js/benchmark.js](assets/js/benchmark.js)
owns everything (selectors, summary, charts, details, load times, URL state, accessibility) and
is generic over the *series* being compared. Each page loads its results, defines a `page`
object in a small inline script at the bottom of `<body>` and calls `startBenchmark()`:
[index.html](index.html) compares solutions on one machine (series = `solution`, with the
open-source / sort-columns / hardware inline filters and the memory, data-size and
query-failure charts), [pages/hardware/index.html](pages/hardware/index.html) compares machines
running one solution (series = `machine`, `page_solution` picks it), and
[pages/threadscaling/index.html](pages/threadscaling/index.html) compares the thread counts of
one solution on one machine (series = the thread count). All three carry the NUMA node filter,
built with the engine's `buildMultiSelect` from `availableNumanodes()` and applied in
`page.matches` via `numanodeSelected`. The contract of `page` is documented at the top of
`benchmark.js`; a new comparison page should be another `page` object rather than a copy of
the engine.

The thread scaling page is the one that reshapes its data: the engine keys measurements as
`result[thread count]` and picks one with the single-selection `selectors.threads`, so the page
splits each entry per thread count and re-keys `result`/`load_time` under one collapsed key,
freeing the thread count to be the series. Its `selectors_threads` row is therefore hidden, and
its `baselineScope` must pin the machine - unlike the hardware page, its series label does not.

## Conventions and gotchas

* **`results` is in `.gitignore`, yet audited results are tracked.** Existing files stay
  tracked; adding a new run directory needs `git add -f`. Only curated runs belong in git.
* **The drivers are Linux-oriented**: `/usr/bin/time -v`, `lscpu`, `numactl`, `iostat`,
  `findmnt`. `save_environment` has a macOS branch, but a real benchmark run on macOS is not
  supported.
* **Python is run via `uv run`, never via a virtualenv.** The PEP 723 inline `# /// script`
  block at the top of each entry point (`pysrc/queryrunner/main.py`,
  `pysrc/taqToParquet/main.py`) is authoritative for dependencies — that is where you pin an
  engine version to benchmark it (e.g. `"pykx==4.0.0"`). [pyproject.toml](pyproject.toml)
  only mirrors the union for tooling; `package = false`.
* **kdb+ side requires KDB-X ≥ 5.0** (module framework). `generateDB.sh` extends `QPATH` with
  `./external` and the installed module dir. q entry points parse args with `.Q.opt` and
  validate them against explicit `MANDATORY` / `ALLOWED` symbol lists, printing `USAGE` and
  exiting non-zero — keep that pattern when adding options.
* **Engine equivalence is a hard requirement**, not a nicety: a new or changed query must
  return identical output across engines (floats within `FLOATDIFFTHREASHOLD`), verified with
  `--query-output-dir` + `src/compareOutput.q`. Executor `write_csv` output must be
  kdb+-loadable (booleans as `1`/`0`, temporals as q literals).
* **Reading results**: compare warm runs (`run2timeNS`/`run3timeNS`) at equal `threadcount`
  and `idx`. IO columns should be ~0 for these in-memory benchmarks. A failing engine yields
  `status=error` rows instead of aborting the suite — inspect those rows and the solution's
  `os.txt`.
* Commit messages follow `KDBX-<ticket><suffix> <summary>` (e.g.
  `KDBX-694Fix34 adding a dashboard section to the main doc`), with work merged into `main`
  from per-change branches.
