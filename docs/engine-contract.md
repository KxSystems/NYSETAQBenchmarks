# The engine runner contract

What a program has to do to be a benchmark arm.

This is a description of the two runners already in the tree, not a new design:
[`src/runQueries.q`](../src/runQueries.q) (KDB-X) and
[`pysrc/queryrunner/main.py`](../pysrc/queryrunner/main.py) (DuckDB, Polars, chDB, Pandas,
pykx) are the same contract implemented twice, and
[`src/qengine/runQueries.lite.q`](../src/qengine/runQueries.lite.q) is a third. Where they
disagree today, this file says so rather than picking a winner; those are bugs to settle, and
settling them is the point of writing it down.

A runner is invoked by [`benchmarks/inmemory/common.sh`](../benchmarks/inmemory/common.sh)'s
`run_solution`, which appends `-result`, `-tableStatsDir` and (when asked for)
`-queryOutputDir` to whatever the driver arm supplies, runs the whole thing under
`/usr/bin/time -v`, and prepends the `solution` column to the PSV afterwards. The runner knows
nothing about solutions.

## 1. Command line

Every option is `-name value`, single-dash, in any order.

| Option | Required | Meaning |
|---|---|---|
| `-db` | yes | Database directory to load |
| `-storage_backend` | yes | `memory` or `disk` |
| `-paramdir` | yes | Directory of `artifacts/parameters/<SIZE>/*.txt` |
| `-queryfile` | yes | The engine's PSV of queries |
| `-querymeta` | yes | `artifacts/queries/inmemory/querymeta.psv` |
| `-date` | for `memory` | Partition date, `YYYYMMDD` |
| `-sortcols` | no | Comma-separated sort columns for `trade`/`quote` |
| `-indexon` | no | Column to index/attribute, `''`, `time` or `sym` |
| `-engine` | no | Engine flavour within the runner |
| `-format` | no | Data format the runner should read |
| `-result` | no | PSV to write the result rows to |
| `-tableStatsDir` | no | Directory to write `stats.yaml` into |
| `-queryOutputDir` | no | Directory to write `queryoutput_<idx>.csv` into |
| `-tags` | no | Comma-separated query tags to keep |
| `-instrument` | no | `single`, `multi`, `all`, optionally `:<subscope>` |
| `-idx` | no | `42`, `32,42,50` or `40-44` |

`FLUSH` must be set in the environment and must name an executable; the drivers point it at
`flush/noflush.sh` for in-memory runs.

## 2. Artifacts

- **`-result` PSV** — section 3. Written with the header even if no query runs.
- **`-tableStatsDir/stats.yaml`** — top-level `proprietary`, `engineversion` and `sortcols`
  scalars, then one block per table (`master`, `trade`, `quote`) with `name`, `size (MB)`,
  `rowCount`, `columnCount` and a `columns` list of `name`/`type`/`attr`.
  [`pysrc/convertToJSFormat.py`](../pysrc/convertToJSFormat.py) reads the scalars and sums
  `size (MB)`, skipping any value that is not a number, so a runner that cannot measure a
  size writes a word rather than a zero. `common.sh`'s `check_table_stats` compares
  `rowCount`/`columnCount` across solutions and warns on a mismatch — an arm whose counts
  differ loaded different data and its timings are not comparable.
- **`-queryOutputDir/queryoutput_<idx>.csv`** — the first run's result, for
  [`src/compareOutput.q`](../src/compareOutput.q). Must be kdb+-loadable: booleans as `1`/`0`,
  temporals as q literals. Floats are compared within `FLOATDIFFTHREASHOLD`, so formatting
  may differ. This is telemetry: failing to write it must not lose the run.

## 3. The result PSV

Exactly these 18 columns, in this order, `|`-separated, one header line:

```
storagebackend|compparam|threadcount|runner|engine|format|indexon|idx|query|status|
run1timeNS|run2timeNS|run3timeNS|run3memKB|run1ioKB|run2ioKB|run3ioKB|ressizeKB
```

| Column | Content |
|---|---|
| `storagebackend` | `-storage_backend` as given |
| `compparam` | `<logicalBlockSize>_<algorithm>_<zipLevel>`; `0_0_0` when uncompressed, `nyi` when unknown |
| `threadcount` | Threads the engine actually used, minimum 1 — not what the driver asked for |
| `runner` | Which runner wrote the row (`KDB-X`, `Python`, `qlite`) |
| `engine` | `-engine` |
| `format` | `-format`, lower case |
| `indexon` | `-indexon` |
| `idx` | Query index, or `0`/`-1`/`-2`/`-3` for a setup row |
| `query` | The query text, or the setup phase description |
| `status` | Section 5 |
| `run1..3timeNS` | Wall-clock nanoseconds per run; null for a run that did not happen |
| `run3memKB` | Memory the third run allocated, in KB; null or `nyi` when not measurable |
| `run1..3ioKB` | `kB_read` deltas around each run; ~0 for in-memory runs |
| `ressizeKB` | Size of the result, in KB; null or `nyi` when not measurable |

A value that was not measured is null or `nyi` — never `0`. `convertToJSFormat.py` reads only
`idx`, `query` and the three times, and treats `idx <= 0` as a setup row.

## 4. Protocol

**Setup**, in order, each emitting one row:

| `idx` | `query` | When |
|---|---|---|
| `0` | `load a partition into memory` (or `load/mmap DB`) | always |
| `-1` | `transform` | always, even when nothing is transformed |
| `-2` | `sort` | when `-sortcols` is non-empty |
| `-3` | `index` | when `-indexon` asks for one |

The `run1timeNS` of each is the phase's elapsed time; runs 2 and 3 are null.
`convertToJSFormat.py` orders the load-time chart by `idx` descending, so the descriptions
must be stable.

**Queries**: for each row of `-queryfile`, in file order, run the query **three times** —
cold, warm, warm. Before the first run only, execute `$FLUSH <db>`. Collect garbage before
each run. Take the result shape, the persisted CSV and `ressizeKB` from a run, and report all
three elapsed times. One row per query, whether it ran or not.

## 5. `status`

| Value | Meaning |
|---|---|
| `success` | Ran, three times |
| `emptyquery` | The engine has no query at this `idx` |
| `skip` | The query is commented out |
| `idxfiltered` / `tagfiltered` / `instrumentfiltered` | Excluded by `-idx` / `-tags` / `-instrument` |
| anything else | The engine's error text |

A failing query is a row with the error in `status`, not an abort. Filtered queries are rows
too — they are never dropped, so every engine's PSV has the same number of query rows.

## 6. Filters

- `-idx`: keep only these indices; others are `idxfiltered`.
- `-tags`: the query's tags are the union of `-queryfile`'s `tags` column and `querymeta.psv`'s
  `tags` column, empties removed. Keep a query if that set intersects the filter; others are
  `tagfiltered`.
- `-instrument`: `querymeta.psv`'s `instrument` is a base scope (`single`, `multi`, `all`)
  optionally refined after a colon (`single:infrequent`). A filter matches the exact value or
  the base; others are `instrumentfiltered`.

## 7. Aborts

These are configuration errors, and a runner must exit non-zero rather than produce a
half-comparable result:

| Exit | Cause |
|---|---|
| 1 | A mandatory option is missing, or an unknown one was given |
| 2 | An option's value is invalid, or `FLUSH` is unset |
| 3 | `-db`, `-queryfile` or `-querymeta` does not exist |
| 4 | `-queryfile` and `-querymeta` disagree on `idx` at any row, or an `instrument` is missing or invalid |

The `idx` alignment check is what keeps the per-engine query files row-aligned; without it a
single inserted line silently compares different queries across engines.

## 8. Known disagreements between the runners

To be settled, not worked around:

- **Where `#` marks a skip.** `src/runQueries.q` tests the **`idx`** field (`#42`) and strips
  the `#` from the reported idx; `pysrc/queryrunner/main.py` tests the **`query`** field
  (`#select ...`) and strips it from the reported query. `runQueries.lite.q` follows
  `runQueries.q`. No query file currently uses either, which is why it has gone unnoticed.
- **Order of the skip and empty checks.** `runQueries.q` reports an empty query as
  `emptyquery` before considering `#`; `main.py` checks `#` first.
- **What `run3memKB` means.** `runQueries.q` measures the third run and reports null when more
  than one thread is in use; `main.py` always writes null, marked "Not Yet Implemented".
- **Which run `ressizeKB` comes from.** `runQueries.q` measures the third run; `main.py`
  overwrites it on every run, so it ends up being the third; `src/rayforce/runQueries.rfl`
  runs a **fourth** pass and takes it from there (see `FORK.md`).
