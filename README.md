# KX NYSE TAQ Benchmarks

## Overview

This benchmark suite uses publicly available
[NYSE TAQ data](https://ftp.nyse.com/Historical%20Data%20Samples/DAILY%20TAQ/),
with queries that are representative of common financial industry workloads.

The suite provides benchmarks to:

* Compare in-memory query engines (KDB-X, KDB-X Python, Polars, Pandas, and DuckDB).
* Evaluate the impact of KDB-X attributes and memory layout.

Running any benchmark involves four steps:

* [Step 1](#step-1-selecting-a-data-size): Select a data size to control how much data is downloaded and used during the benchmark.
* [Step 2](#step-2-obtaining-the-psv-files): Download the compressed PSV files from the NYSE FTP server.
* [Step 3](#step-3-converting-psv-files-to-binary-data-formats): Convert the files into kdb+ or Parquet format.
* [Step 4](#step-4-selecting-and-running-a-benchmark): Select and run a benchmark.

## Step 1: Selecting a Data Size

A single day of NYSE TAQ data is substantial. To reduce execution time,
you can limit ingestion to a subset of the BBO split CSV files (the source
of the `quote` table).

Use the `SIZE` environment variable to balance execution time against data coverage:

```bash
export SIZE=small
```

* In all modes except `full`, only a subset of the BBO split CSV files is downloaded.
* Only the corresponding trades are converted into the HDB (for example, only
  symbols whose names start with `Z`).

The following statistics are based on data from 2025-01-02:

| `SIZE` | Recommended for | Symbol first letters | HDB size (GB) | Nr of quote symbols | Nr of quotes |
| --- | --- | --- | ---: | ---: | ---: |
| `small` | A quick test to get familiar with the benchmark suite | Z | 1 | 94 | 4 607 158 |
| `medium` | KDB-X Community Edition users | I | 13 | 555 | 180 827 332 |
| `large` | Users with an unlimited KDB-X license but limited memory | A–H | 52 | 4 849 | 707 738 295 |
| `full` | The most thorough testing | A–Z | 233 | 11 155 | 2 313 872 956 |

Use `medium` when running the benchmark with KDB-X Community Edition, which
enforces a memory limit.

## Step 2: Obtaining the PSV Files

Although you can download, decompress, and prepare the PSV files manually, we recommend using the `getPSVs.sh` script from the [KDB-X taq module](https://code.kx.com/kdb-x/modules/taq/overview.html#key-features). The taq repository is included as a git submodule; initialize it with:

```bash
git submodule update --init --recursive
```

Set a directory for storing the PSV files. We use a `DATA` directory inside the
repository (it is listed in `.gitignore`, so the large downloads and generated
databases are never committed). Point `NYSEBENCHMARKDIR` elsewhere if you prefer
to keep the data on a different (e.g. faster or larger) filesystem:

```bash
export NYSEBENCHMARKDIR=$PWD/DATA
```

Fetch the latest available date from the NYSE FTP server and run `getPSVs.sh`:

```bash
export DATE=$(curl -s https://ftp.nyse.com/Historical%20Data%20Samples/DAILY%20TAQ/| grep -oE 'EQY_US_ALL_TRADE_2[0-9]{7}' | grep -oE '2[0-9]{7}'|head -1)

./external/kx/taq/scripts/getPSVs.sh --csvdir ${NYSEBENCHMARKDIR}/${SIZE}/csv --dates ${DATE} --size ${SIZE}
```

The `getPSVs.sh` script:

   1. Downloads the compressed PSV files using `curl -C` (which supports resuming interrupted downloads).
   1. Decompresses the files.
   1. Removes trailing lines.
   1. Adds the correct extension (`.psv`).

## Step 3: Converting PSV Files to Binary Data Formats

The PSV files must be converted to a binary format that the query engines can read directly. Both kdb+ and Parquet formats are supported. Each benchmark has its own data format requirement, so example commands are only provided in [Step 4](#step-4-selecting-and-running-a-benchmark).

The `./generateDB.sh` script wraps the underlying TAQ parsers. Each parser has its own dependencies.

### kdb+ Parser

The kdb+ parser requires:

* [KDB-X to be installed](https://code.kx.com/kdb-x/get_started/kdb-x-install.html).
  The benchmark relies on modules, so KDB-X is required — it does not run on
  kdb+ versions prior to 5.0.
* The KDB-X taq module to be available. This module is included as a git submodule (`git submodule update --init --recursive`), but its [dependencies](https://github.com/KxSystems/taq/blob/main/docs/install.md#dependencies) must be installed manually to the [standard KX module path](https://code.kx.com/kdb-x/modules/module-framework/quickstart.html#search-path).

### Parquet Parser

The Parquet parser uses Python and the PyArrow library. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) to manage your Python environment. The full list of required libraries is defined in the inline script metadata in [pysrc/taqToParquet/main.py](./pysrc/taqToParquet/main.py).

### PSV Cleanup

Exercise caution when running cleanup: downloading PSV files can be time-consuming. Delete the PSV files only when the binary data has been generated and you are sure that no other binary format will be required.

```bash
rm -rf ${NYSEBENCHMARKDIR}/${SIZE}/csv
```

## Step 4: Selecting and Running a Benchmark

Two benchmarks are available:

1. **In-memory query engine benchmark** — compares query execution time across the KDB-X, KDB-X SQL, Polars, DuckDB, Pandas, and KDB-X Python (`pykx`) engines.
1. **In-memory KDB-X attribute and table format comparison** — evaluates the impact of attributes and table dictionary formats.

### 1. In-Memory Query Engine Benchmark — `benchmarks/inmemory/queryEngines.sh`

Query engines read data into memory from Hive-partitioned Parquet or kdb+ format. Convert the TAQ PSV files to these formats using `./generateDB.sh`:

```bash
DATAFORMAT=kdb ./generateDB.sh ${NYSEBENCHMARKDIR}/${SIZE}/csv ${NYSEBENCHMARKDIR}/${SIZE}/kdb ${DATE}
SYMBOLSTOREDAS=ROWGROUP DATAFORMAT=parquet ./generateDB.sh ${NYSEBENCHMARKDIR}/${SIZE}/csv ${NYSEBENCHMARKDIR}/${SIZE}/parquet/rowgroup ${DATE}
```

Once the on-disk data has been generated, you can start the benchmark. Python libraries are run via `uv`, so ensure [uv](https://docs.astral.sh/uv/getting-started/installation/) is installed. To test the engines with 0, 4, 16, and 64 secondary threads, run:

```bash
export NUMANODE=0
./benchmarks/inmemory/queryEngines.sh --db-dir ${NYSEBENCHMARKDIR}/${SIZE} --param-dir ./artifacts/parameters/${SIZE} --date ${DATE}  --threads "0 4 16 64" --results ./results/inmemory/${SIZE}/queryengines.psv --stats-dir ./results/inmemory/${SIZE}/queryengines
```

The script accepts the following mandatory parameters:

| Parameter | Description |
| --- | --- |
| `--db-dir` | Directory containing the generated databases. The script expects the `kdb` and `parquet/rowgroup` subdirectories created by `./generateDB.sh`. |
| `-p`, `--param-dir` | Directory of the query parameters (e.g. `./artifacts/parameters/${SIZE}`). |
| `-d`, `--date` | Target date to query, in the same format as `${DATE}`. |

And the following optional parameters:

| Parameter | Description |
| --- | --- |
| `-t`, `--threads` | Space-separated list of secondary-thread counts to test, e.g. `"0 4 16 64"`. Each engine runs once per value. Default: `"1 4"`. |
| `-e`, `--engines` | Comma-separated subset of engines to run. Valid values: `kdb`, `sql`, `duckdb`, `polars`, `pykx`, `pandas`. Default: all of them. |
| `-s`, `--stats-dir` | Directory to save per-table statistics (one YAML file per table, plus OS `time -v` output). Default: `./results/inmemory/queryengines`. |
| `-i`, `--idx` | Filter queries by index: single (`42`), comma-separated list (`32,42,50`), or range (`40-44`). Default: run all queries. |
| `--results` | Single PSV file that all per-engine results are merged into. The individual per-engine files are written to a temporary directory and removed afterwards. Default: `./results/inmemory/queryengines.psv`. |
| `-h`, `--help` | Show usage and exit. |

The `NUMANODE` environment variable is also honoured: when set, every engine is launched
under `numactl -N ${NUMANODE} -m ${NUMANODE}` to pin CPU and memory allocation to that NUMA node.


To pin a specific library version, edit the inline script metadata in `pysrc/queryrunner/main.py`. For example:

```python
#   "pykx==4.0.0",
```

#### Results

The script merges every engine's results into a single pipe-separated values (PSV) file
(set by `--results`), one row per query (plus a few rows for the data-loading steps).

The file starts with a header row. The columns are:

| Column | Description |
| --- | --- |
| `storagebackend` | Where the data is read from: `inmemory` or `ondisk`. |
| `compparam` | Compression parameter used for the data. |
| `threadcount` | Number of (secondary/worker) threads the engine was configured to use. `0` means no secondary threads. |
| `runner` | The harness driving the engine, e.g. `KDB-X` or `Python`. |
| `engine` | The query engine, e.g. `pykx`, `duckdb_con`, `polars`, `pandas`. |
| `format` | Data format. |
| `sortcols` | Columns the `trade`/`quote` tables were sorted by before querying, e.g. `time` or `sym,time`. Empty if unsorted. |
| `indexon` | Columns an index/attribute was applied to, e.g. `sym`. Empty if none. |
| `engineversion` | Version string of the engine library, e.g. `1.5.4`. |
| `idx` | Query index. Positive integers are benchmark queries; non-positive values are setup steps: `0` = load a partition into memory, `-1` = transform, `-2` = sort, `-3` = index. |
| `tags` | Comma-separated category tags for the query (e.g. `timefilter,groupby,advanced`). Setup rows are tagged `load`. |
| `query` | The query text that was executed (or a short description for setup rows). |
| `status` | Outcome: `success`, `error` (query raised an exception), `idxfiltered` (skipped by the `--idx` filter), or `tagfiltered` (skipped by the `--tags` filter). |
| `run1timeNS` | Execution time of run 1 (cold) in nanoseconds. Setup rows record their elapsed time here. |
| `run2timeNS` | Execution time of run 2 (warm) in nanoseconds. |
| `run3timeNS` | Execution time of run 3 (warm) in nanoseconds. |
| `run3memKB` | Peak memory of the query of run 3 in KB. |
| `run1ioKB` | Disk I/O during run 1 in KB. Should be zero for in-memory benchmarks. |
| `run2ioKB` | Disk I/O during run 2 in KB. Should be zero for in-memory benchmarks. |
| `run3ioKB` | Disk I/O during run 3 in KB. Should be zero for in-memory benchmarks. |
| `ressizeKB` | Size of the query result in KB. |

Each benchmark query is run three times (one cold run followed by two warm runs); columns are
empty when a value does not apply (e.g. timing/IO columns for an `error` row, or warm-run
columns for setup rows).

### 2. In-Memory KDB-X Attribute Benchmark — `benchmarks/inmemory/kdbAttributes.sh`

Data is read into memory from kdb+ format. Convert the TAQ PSV files to this format using `./generateDB.sh`:

```bash
DATAFORMAT=kdb ./generateDB.sh ${NYSEBENCHMARKDIR}/${SIZE}/csv ${NYSEBENCHMARKDIR}/${SIZE}/kdb ${DATE}
```

Once the on-disk data has been generated, you can start the benchmark. To test with 0, 4, 16, and 64 secondary threads, run:

```bash
export NUMANODE=0
./benchmarks/inmemory/kdbAttributes.sh --db-dir ${NYSEBENCHMARKDIR}/${SIZE} --param-dir ./artifacts/parameters/${SIZE} --date ${DATE} --threads "0 4 16 64" --results ./results/inmemory/${SIZE}/kdbattr.psv --stats-dir ./results/inmemory/${SIZE}/kdbattr
```

#### Results

The scripts write the results as pipe-separated values (PSV) files of the same format as [queryEngines.sh](#results)

## Extending the Benchmarks

The suite is designed to be extended in two common ways: adding another query
engine, and growing the query set. Both are described below.

### Adding a New Python-Based In-Memory Query Engine

Python engines live in [pysrc/queryrunner/executors/inmemory/](./pysrc/queryrunner/executors/inmemory/).
Each engine is a single class that is driven by the shared runner
[pysrc/queryrunner/main.py](./pysrc/queryrunner/main.py). The runner handles
flushing, timing (one cold run followed by two warm runs), result writing, and
PSV output; your class only has to load the data and execute queries.

Use an existing executor as a template. [polars.py](./pysrc/queryrunner/executors/inmemory/polars.py)
and [pandas.py](./pysrc/queryrunner/executors/inmemory/pandas.py) read the
Hive-partitioned Parquet database; [pykx.py](./pysrc/queryrunner/executors/inmemory/pykx.py)
reads the kdb+ database instead.

1. **Create the executor class.** Implement the informal interface the runner
   expects (see [main.py](./pysrc/queryrunner/main.py) and the existing
   executors):

   | Method | Responsibility |
   | --- | --- |
   | `__init__(self, param, sort_cols, ...)` | Stash parameters/options and build any engine-specific lookup tables (e.g. `timeBuckets`). |
   | `load_resources(self, db_path, datadate, writer, row_start, ios)` | Load `exnames`/`master`/`trade`/`quote` into memory, then transform, sort by `sort_cols`, and (optionally) index. Emit one setup row per phase via `writer.writerow(row_start + [...])`: `idx` `0` = load, `-1` = transform, `-2` = sort, `-3` = index. |
   | `prepare_run(self)` | Reset any per-run state before each of the 3 timed runs. |
   | `get_parameters(self, parameter)` | Pre-process the raw `parameter` string into whatever `execute_query` expects (excluded from the measured time). |
   | `execute_query(self, idx, tags, query_str, params, runidx)` | Execute the query and return the result object. |
   | `get_table_size(df)` (static) | Result/table size in KB, or `None` if unavailable. |
   | `get_table_stats(self)` | Per-table stats dict written to the `--stats-dir` YAML files. |
   | `write_csv(self, res, out_file)` | Serialize a result to CSV for cross-engine output comparison. The CSV must be in **kdb+-loadable format**, so values need special formatting: booleans as `1`/`0` (not `true`/`false`), and temporal values as kdb+ literals (e.g. timespans like `0D09:30:00.000000000`). See the `write_csv` implementations in [polars.py](./pysrc/queryrunner/executors/inmemory/polars.py) and [pandas.py](./pysrc/queryrunner/executors/inmemory/pandas.py) for the duration/boolean conversions. |

2. **Wire it into the runner.** In [main.py](./pysrc/queryrunner/main.py), add an
   `elif engine == "<name>":` branch inside the `inmemory` block that imports and
   instantiates your class as `runner` and sets `threadnr` and `engineversion`.
   Also add `"<name>"` to the `-engine` argument's `choices` list in
   `build_parser`.

3. **Declare dependencies.** Add any new library to the inline script metadata
   (the PEP 723 `# /// script` block at the top of `main.py`) so `uv run`
   installs it.

4. **Add a query file.** Create `artifacts/queries/inmemory/<name>.psv` with the
   queries written in your engine's syntax. It must stay index-aligned with
   `querymeta.psv` — see [Extending the Query Set](#extending-the-query-set-with-new-queries).

5. **Add it to the driver.** In [benchmarks/inmemory/queryEngines.sh](./benchmarks/inmemory/queryEngines.sh),
   add an `engine_enabled <name>` block that calls
   `uv run pysrc/queryrunner/main.py ... -engine <name> -queryfile ./artifacts/queries/inmemory/<name>.psv ...`
   followed by `add_nickname`, and add `<name>` to the default `ENGINES` list.
   Optionally add a matching run in `get_table_stats`. Each engine is launched
   once per requested thread count; if the library is configured through an
   environment variable, set it inline as the existing engines do (e.g.
   `POLARS_MAX_THREADS`, `DUCKDB_THREADS`, `OMP_NUM_THREADS`).

### Extending the Query Set with New Queries

Queries are defined **per engine** in PSV files under
[artifacts/queries/inmemory/](./artifacts/queries/inmemory/) (`kdb.psv`,
`sql.psv`, `duckdb.psv`, `polars.psv`, `pandas.psv`, `pykx.psv`, and the
attribute-benchmark variants `kdb_noattr.psv`, `kdb_tabledict.psv`). Each file
has the columns:

| Column | Meaning |
| --- | --- |
| `idx` | Query index. Must be identical, row for row, across every query file **and** `querymeta.psv`. |
| `tags` | Optional engine-specific extra tags (usually empty). |
| `query` | The query text in that engine's syntax. |
| `parameter` | Comma-separated names of parameters injected into the query (e.g. `datadate`, `aFreqInstr`, `twentyInstrs`, `timeBuckets`). Empty if the query takes none. |

Engine-independent metadata lives in `artifacts/queries/inmemory/querymeta.psv`
(`idx|tags|description|comment`). At runtime the runners join each query to its
meta row by `idx` and **abort on any index mismatch** between a query file and
`querymeta.psv` (see the checks in [main.py](./pysrc/queryrunner/main.py) and
[src/runQueries.q](./src/runQueries.q)). Consequently, every query you add must
appear — at the same row position and with the same index — in all engine files
you want to benchmark **and** in `querymeta.psv`.

Parameter names in the `parameter` column are resolved from the per-size files
in `artifacts/parameters/${SIZE}/*.txt`. To introduce a brand-new parameter, add
its `.txt` file to every size directory and load it in both
`load_parameters` ([main.py](./pysrc/queryrunner/main.py)) and
[src/getQueryParameters.q](./src/getQueryParameters.q).

**Appending a query** (no existing indices change):

1. Add a row with the next free `idx` to each engine query file, expressing the
   same logical query in that engine's syntax.
2. Add a matching row (same `idx`) to `querymeta.psv` with a `description` and
   tags.

**Inserting a query in the middle** (existing indices must shift): because
indices are sequential, inserting renumbers every query after the insertion
point. Rather than renumbering by hand, use
[artifacts/queries/reindex.sh](./artifacts/queries/reindex.sh):

1. Insert the new row at the **same position** in each query file and in
   `querymeta.psv` (the `idx` value can be left inconsistent for now).
2. Renumber the `idx` column of every affected file to `1, 2, 3, …` based on row
   order:
   ```bash
   ./artifacts/queries/reindex.sh artifacts/queries/inmemory/*.psv
   ```
   The script rewrites each PSV in place (preserving the header) and numbers
   purely by row position, so indices stay aligned across files as long as the
   inserted row sits at the same position in each. Commit or back up first, and
   pass only the query/meta PSVs — not result files.
