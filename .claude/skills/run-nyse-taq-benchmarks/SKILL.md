---
name: run-nyse-taq-benchmarks
description: Run the KX NYSE TAQ benchmark suite end-to-end. Use when the user wants to benchmark in-memory query engines (KDB-X, KDB-X SQL, Polars, DuckDB, Pandas, pykx) or compare KDB-X attributes/table formats on NYSE TAQ data — i.e. selecting a data SIZE, downloading PSV files, generating kdb+/Parquet databases, and running queryEngines.sh or kdbAttributes.sh and reading the PSV results.
---

# Run the NYSE TAQ Benchmarks

Guide a user through running this suite from a clean checkout to a populated
results PSV. The workflow has four ordered steps — **each depends on the
previous one**, so do not skip ahead. Confirm the user has completed (or wants
help with) each step before moving on.

The canonical reference is the project [README.md](../../../README.md); this
skill is the operational playbook for driving it. When a command or table here
disagrees with the README, the README wins — re-read it.

## Before you start: orient the user

Ask (or infer from the request) two things:

1. **Which benchmark?**
   - *In-memory query engine* (`benchmarks/inmemory/queryEngines.sh`) — compares
     KDB-X, KDB-X SQL, DuckDB, Polars, Pandas, pykx. Needs **both** kdb+ and
     Hive-partitioned Parquet databases.
   - *KDB-X attribute / table-format* (`benchmarks/inmemory/kdbAttributes.sh`) —
     measures the impact of sort columns, `sym`/`time` attributes, and table-dict
     layout. Needs **only** the kdb+ database.
2. **What `SIZE`?** This controls download volume and memory needs (see Step 1).
   Larger sizes require more resources (network, disk, and memory) and take
   longer to run the benchmark. When unsure, recommend `small` for a first run,
   `medium` for KDB-X Community Edition (it has a memory cap).
3. **Is the data already generated?** Steps 2–3 (download + DB generation) are
   the slow, expensive part and are often already done from a previous run. A
   common case is wanting to **re-run queries with different parameters** (e.g.
   other thread counts, a different engine subset, or a query-index filter) on
   data that already exists. Always check this **before** Step 1 — see the next
   section.

## Before you start: is the data already there?

Do **not** assume a clean checkout. Ask the user whether they want to start from
scratch or reuse existing data, and verify on disk. The expected layout is
`${NYSEBENCHMARKDIR}/${SIZE}/{kdb,parquet/rowgroup}` (set `NYSEBENCHMARKDIR` and
`SIZE` first — see Steps 1–2).

```bash
# What sizes / formats already exist?
ls -d ${NYSEBENCHMARKDIR}/*/ 2>/dev/null
du -sh ${NYSEBENCHMARKDIR}/${SIZE}/kdb ${NYSEBENCHMARKDIR}/${SIZE}/parquet/rowgroup 2>/dev/null
```

Decide where to enter the workflow:

- **Start from scratch** (nothing exists, or the user wants a fresh dataset) →
  do Steps 1–4 in order.
- **Reuse existing data** (the directories above are populated for the chosen
  `SIZE`, and the data format matches the benchmark — kdb+ for either benchmark,
  Parquet additionally for the query-engine benchmark) → **skip Steps 2–3 and go
  straight to [Step 4](#step-4--run-the-benchmark)**. This is the right path when
  the user just wants to re-run with different thread counts or other query
  parameters. Still confirm `SIZE` and `DATE` match what was generated, and that
  the format required by the chosen benchmark is present.
- **Partially present** (e.g. kdb+ exists but Parquet does not, and the
  query-engine benchmark needs both) → run only the missing part of Step 3, then
  go to Step 4.

If unsure whether the on-disk data is complete/valid, regenerate the missing
format rather than guessing — a half-generated DB causes confusing failures.

## Prerequisites

Check these before running anything; a missing one causes a confusing
mid-pipeline failure:

- **KDB-X (`q`) installed and on `PATH`** — required for the kdb+ parser and all
  kdb/sql runs. See https://code.kx.com/kdb-x/get_started/kdb-x-install.html
- **`uv`** (Astral) — runs every Python engine and the Parquet parser.
  https://docs.astral.sh/uv/getting-started/installation/
- **Git submodule initialized** — the suite calls scripts from the KDB-X taq
  module:
  ```bash
  git submodule update --init --recursive
  ```
  For the kdb+ parser, the taq module's own dependencies must also be installed
  to the standard KX module path (see the README's *kdb+ Parser* section).
- **`numactl`** — only if the user wants NUMA pinning via `NUMANODE` (optional).
- Disk space matching the chosen `SIZE` (see the HDB-size column below).

## Step 1 — Select a data size

```bash
export SIZE=small   # small | medium | large | full
```

| `SIZE`  | Use for                                   | Symbols | HDB size | # quotes        |
| ------- | ----------------------------------------- | ------- | -------: | --------------: |
| `small` | quick familiarization (symbols: Z)        | 94      | ~1 GB    | 4,607,158       |
| `medium`| KDB-X Community Edition (symbols: I)       | 555     | ~13 GB   | 180,827,332     |
| `large` | unlimited license, limited RAM (A–H)       | 4,849   | ~52 GB   | 707,738,295     |
| `full`  | most thorough (A–Z)                        | 11,155  | ~233 GB  | 2,313,872,956   |

`SIZE` must stay consistent across every later step — the parameter files in
`artifacts/parameters/${SIZE}` and the symbol subset all key off it. If the user
changes `SIZE`, re-run Steps 2–3.

## Step 2 — Download the PSV files

```bash
export NYSEBENCHMARKDIR=$PWD/DATA   # where PSVs + DBs live (under the repo's DATA dir, gitignored)

# Latest available date on the NYSE FTP server:
export DATE=$(curl -s https://ftp.nyse.com/Historical%20Data%20Samples/DAILY%20TAQ/ \
  | grep -oE 'EQY_US_ALL_TRADE_2[0-9]{7}' | grep -oE '2[0-9]{7}' | head -1)

./external/kx/taq/scripts/getPSVs.sh \
  --csvdir ${NYSEBENCHMARKDIR}/${SIZE}/psv --dates ${DATE} --size ${SIZE}
```

Notes:
- Downloads use `curl -C` and **resume** if interrupted — safe to re-run.
- `${DATE}` is reused by every later command; keep it exported in the session.
- This is the slow, network-heavy step. Do **not** delete the `psv` directory
  until the binary databases are generated and verified (Step 3).

## Step 3 — Generate the binary database(s)

`./generateDB.sh <csvdir> <dstdir> <date>` wraps the kdb+ and Parquet parsers;
the format is chosen by the `DATAFORMAT` env var.

**For the query-engine benchmark — generate BOTH formats:**
```bash
DATAFORMAT=kdb ./generateDB.sh \
  ${NYSEBENCHMARKDIR}/${SIZE}/psv ${NYSEBENCHMARKDIR}/${SIZE}/kdb ${DATE}

SYMBOLSTOREDAS=ROWGROUP DATAFORMAT=parquet ./generateDB.sh \
  ${NYSEBENCHMARKDIR}/${SIZE}/psv ${NYSEBENCHMARKDIR}/${SIZE}/parquet/rowgroup ${DATE}
```

**For the attribute benchmark — kdb+ only:**
```bash
DATAFORMAT=kdb ./generateDB.sh \
  ${NYSEBENCHMARKDIR}/${SIZE}/psv ${NYSEBENCHMARKDIR}/${SIZE}/kdb ${DATE}
```

The benchmark scripts expect the layout `${NYSEBENCHMARKDIR}/${SIZE}/{kdb,parquet/rowgroup}`,
so keep these exact destination paths.

Once binaries exist and a benchmark has run cleanly, the PSVs can be reclaimed:
```bash
rm -rf ${NYSEBENCHMARKDIR}/${SIZE}/psv
```

## Step 4 — Run the benchmark

`--db-dir` is the per-size directory (`${NYSEBENCHMARKDIR}/${SIZE}`), **not** the
`kdb`/`parquet` subdirectory — the scripts append those themselves.

### Query-engine benchmark
```bash
export NUMANODE=0   # optional: pins CPU+memory to NUMA node 0 via numactl
./benchmarks/inmemory/queryEngines.sh \
  --db-dir   ${NYSEBENCHMARKDIR}/${SIZE} \
  --param-dir ./artifacts/parameters/${SIZE} \
  --date     ${DATE} \
  --threads  "0 4 16 64" \
  --results  ./results/inmemory/${SIZE}/queryengines.psv \
  --stats-dir ./results/inmemory/${SIZE}/queryengines
```

### Attribute / table-format benchmark
```bash
export NUMANODE=0
./benchmarks/inmemory/kdbAttributes.sh \
  --db-dir   ${NYSEBENCHMARKDIR}/${SIZE} \
  --param-dir ./artifacts/parameters/${SIZE} \
  --date     ${DATE} \
  --threads  "0 4 16 64" \
  --results  ./results/inmemory/${SIZE}/kdbattr.psv \
  --stats-dir ./results/inmemory/${SIZE}/kdbattr
```

### Arguments

Mandatory: `--db-dir`, `-p/--param-dir`, `-d/--date`.

Optional:
| Flag | Meaning | Default |
| --- | --- | --- |
| `-t`, `--threads` | space-separated secondary-thread counts to test; each engine runs once per value (`0` = no secondary threads) | `"1 4"` |
| `-e`, `--engines` | (queryEngines only) comma-separated subset of `kdb,sql,duckdb,polars,pykx,pandas` | all |
| `-s`, `--stats-dir` | per-table stats (one YAML per table + `time -v` output) | `./results/inmemory/<bench>` |
| `-i`, `--idx` | run a subset of queries: `42`, `32,42,50`, or range `40-44` | all |
| `-r`, `--results` | single merged output PSV | `./results/inmemory/<bench>.psv` |
| `-h`, `--help` | usage | — |

Tips for narrowing a run while iterating:
- Use `--engines kdb,duckdb` and `--idx 40-44` to do a fast sanity run before a
  full sweep.
- Pin engine library versions by editing the inline script metadata in
  `pysrc/queryrunner/main.py` (e.g. `"pykx==4.0.0"`).
- `NUMANODE` launches every engine under `numactl -N <n> -m <n>`. Leave it unset
  on machines without NUMA or when pinning is not wanted.
- `pykx` is currently commented out in `queryEngines.sh`; don't promise pykx
  numbers from that script unless it has been re-enabled.

## Reading the results

Both scripts emit one merged **pipe-separated (PSV)** file (`--results`): a
header row, one row per query, plus setup rows. Key columns:

- `runner` / `engine` — harness and engine (e.g. `KDB-X`/`kdb`, `Python`/`duckdb_con`).
- `nickname` — distinguishes runs of the same engine with different sort/index
  options (e.g. `kdb`, `kdbParted`, `kdbTimeSorted`, `kdbTableDict`).
- `sortcols` / `indexon` — sort columns and applied attribute (`sym`, `time`, …).
- `threadcount` — secondary threads used (`0` = none).
- `idx` — query index. Positive = a benchmark query; non-positive = setup:
  `0` load partition, `-1` transform, `-2` sort, `-3` index.
- `tags` — query category tags (e.g. `timefilter,groupby,advanced`); setup rows
  are tagged `load`.
- `status` — `success`, `error`, `idxfiltered`, or `tagfiltered`.
- `run1timeNS` (cold) / `run2timeNS`, `run3timeNS` (warm) — each query runs
  3×; `run3memKB` is peak memory of run 3; `ressizeKB` is result size.
  IO columns should be ~0 for these in-memory benchmarks.

When comparing engines, compare warm runs (`run2`/`run3`) at the same
`threadcount` and `idx`. Per-table stats and OS `time -v` output land under
`--stats-dir`.

## Troubleshooting

- **`command not found: q` / `uv`** — install the missing prerequisite (above).
- **`getPSVs.sh: No such file`** — the submodule isn't initialized; run
  `git submodule update --init --recursive`.
- **kdb+ parser errors about missing modules** — the taq module's dependencies
  aren't on the KX module path; see the README *kdb+ Parser* section.
- **`No result PSV files found … nothing to merge`** — every engine run failed
  (often a missing DB or wrong `--db-dir`). Re-check Step 3 produced
  `${SIZE}/kdb` and/or `${SIZE}/parquet/rowgroup`.
- **Out-of-memory on `medium`+ with Community Edition** — drop to `small`, or use
  a non-Community KDB-X license.
- A single engine erroring shows up as `status=error` rows rather than aborting
  the suite — inspect those rows and the `--stats-dir` `os.txt` for the cause.
