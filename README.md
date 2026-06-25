# KX NYSE TAQ Benchmarks

## Overview

This benchmark suite uses publicly available
[NYSE TAQ data](https://ftp.nyse.com/Historical%20Data%20Samples/DAILY%20TAQ/),
with queries that are representative of common financial industry workloads.

The suite provides benchmarks to:

* compare in-memory query engines (KDB-X, KDB-X Python, Polars, Pandas, and DuckDB);
* evaluate the impact of KDB-X attributes and memory layout.

Running any benchmark involves three steps:

1. Download the compressed PSV files from the NYSE FTP server.
1. Convert the files into kdb+ or Parquet format.
1. Select and run a benchmark.

## Data Size

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

| `SIZE` | Symbol first letters | HDB size (GB) | Nr of quote symbols | Nr of quotes |
| --- | --- | ---: | ---: | ---: |
| `small` | Z | 1 | 94 | 4 607 158 |
| `medium` | I | 13 | 555 | 180 827 332 |
| `large` | A–H | 52 | 4 849 | 707 738 295 |
| `full` | A–Z | 233 | 11 155 | 2 313 872 956 |

Use `medium` when running the benchmark with KDB-X Community Edition, which
enforces a memory limit.

## Step 1: Obtaining the PSV Files

Although you can download, decompress, and prepare the PSV files manually, we recommend using the `getPSVs.sh` script from the [KDB-X taq module](https://code.kx.com/kdb-x/modules/taq/overview.html#key-features). The taq repository is included as a git submodule; initialize it with:

```bash
git submodule update --init --recursive
```

Set a directory for storing the PSV files:

```bash
export NYSEBENCHMARKDIR=/tmp/nysetaqkxbenchmark
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

## Step 2: Converting PSV Files to Binary Data Formats

The PSV files must be converted to a binary format that the query engines can read directly. Both kdb+ and Parquet formats are supported. Each benchmark has its own data format requirement, so example commands are only provided in [Step 3](#step-3-selecting-and-running-a-benchmark).

The `./generateDB.sh` script wraps the underlying TAQ parsers. Each parser has its own dependencies.

### kdb+ Parser

The kdb+ parser requires:

* [KDB-X to be installed](https://code.kx.com/kdb-x/get_started/kdb-x-install.html).
* The KDB-X taq module to be available. This module is included as a git submodule (`git submodule update --init --recursive`), but its [dependencies](https://github.com/KxSystems/taq/blob/main/docs/install.md#dependencies) must be installed manually.

### Parquet Parser

The Parquet parser uses Python and the PyArrow library. Install [uv](https://docs.astral.sh/uv/getting-started/installation/) to manage your Python environment. The full list of required libraries is defined in the inline script metadata in `pysrc/taqToParquet/main.py`.

### PSV Cleanup

Exercise caution when running cleanup: downloading PSV files can be time-consuming. Delete the PSV files only when the binary data has been generated and you are sure that no other binary format will be required.

```bash
rm -rf ${NYSEBENCHMARKDIR}/${SIZE}/csv
```

## Step 3: Selecting and Running a Benchmark

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
./benchmarks/inmemory/queryEngines.sh --db-dir ${NYSEBENCHMARKDIR}/${SIZE} --param-dir ./artifacts/parameters/${SIZE} --date ${DATE}  --threads "0 4 16 64" --result-dir ./results/inmemory/queryengines/${SIZE} --stats-dir ./results/inmemory/queryengines/${SIZE}
```

Use `--engines` to run a subset of engines (default: all):

```bash
./benchmarks/inmemory/queryEngines.sh --db-dir ${NYSEBENCHMARKDIR}/${SIZE} --param-dir ./artifacts/parameters/${SIZE} --date ${DATE} --engines "kdb,duckdb"
```

To pin a specific library version, edit the inline script metadata in `pysrc/queryrunner/main.py`. For example:

```python
#   "pykx==4.0.0",
```

#### Results

The scripts write the results as pipe-separated values (PSV) files.

### 2. In-Memory KDB-X Attribute Benchmark — `benchmarks/inmemory/kdbAttributes.sh`

Data is read into memory from kdb+ format. Convert the TAQ PSV files to this format using `./generateDB.sh`:

```bash
DATAFORMAT=kdb ./generateDB.sh ${NYSEBENCHMARKDIR}/${SIZE}/csv ${NYSEBENCHMARKDIR}/${SIZE}/kdb ${DATE}
```

Once the on-disk data has been generated, you can start the benchmark. To test with 0, 4, 16, and 64 secondary threads, run:

```bash
export NUMANODE=0
./benchmarks/inmemory/kdbAttributes.sh --db-dir ${NYSEBENCHMARKDIR}/${SIZE} --param-dir ./artifacts/parameters/${SIZE} --date ${DATE} --threads "0 4 16 64" --result-dir ./results/inmemory/kdbattr/${SIZE} --stats-dir ./results/inmemory/kdbattr/${SIZE}
```

#### Results

The scripts write the results as pipe-separated values (PSV) files.
