# Dashboard data format (`data.json`)

[convertToJSON.py](convertToJSON.py) writes one `data.json` per data size
(`results/inmemory/<size>/data.json`). Each file is self-contained: it holds the
query list, the solutions, the machines and every measured run for that size.

```bash
uv run pysrc/convertToJSON.py ./results/inmemory/<size> ./results/inmemory/<size>/data.json
```

## Conventions

- Times are integers in **nanoseconds** (`*_ns`), memory in **kilobytes**
  (`*_kb`), data sizes in **megabytes** (`*_mb`).
- Dates are ISO strings (`"2026-04-01"`).
- Object keys that are numbers in spirit - query `idx`, thread count - are
  strings, as JSON requires (`"42"`, `"16"`).
- `null` means "not known" (e.g. a field a run predates).

## Top level

| Field | Type | Description |
|---|---|---|
| `schema_version` | integer | Version of this format, currently `1`. A reader should refuse a version it does not know. |
| `size` | string | Data size the file describes: `full`, `xlarge`, `large`, ... |
| `generated_at` | string | UTC time the file was written (`2026-10-25T08:27:00Z`). |
| `load_phases` | string[] | Load phase keys in pipeline order: `load`, `transform`, `sort`, `index`. |
| `tags` | object | Query tag -> one-sentence description. |
| `queries` | object[] | The benchmark queries, by `idx`. |
| `solutions` | object | Solution name -> solution. |
| `machines` | object | Machine name -> machine. |
| `runs` | object[] | Measurements, one per solution, machine, data date and NUMA node. |

## `queries[]`

Engine-independent description of each query, from `artifacts/queries/inmemory/querymeta.psv`.

| Field | Type | Description |
|---|---|---|
| `idx` | integer | Query number, from `1`. Results refer to queries by it. |
| `description` | string | What the query does, in plain English. |
| `tags` | string[] | Tags from `tags` above. |
| `instrument` | string | Instrument scope: `single`, `multi` or `all`, optionally refined after a colon (`single:frequent`, `single:infrequent`, `multi:50`, `multi:1000infreq`). |
| `complexity` | string | `simple`, `advanced` or `complex`. |
| `comment` | string | Optional note; absent when empty. |

## `solutions{}`

A solution is an engine with a particular configuration (sort order, index,
query style), e.g. `KDB-X`, `KDB-X (Parted)`, `DuckDB (Index)`, `Polars (Lazy)`.

| Field | Type | Description |
|---|---|---|
| `engine` | string \| null | Engine that ran the queries (`q-sql`, `SQL`, `duckdb_con`, `chdb`, `chdb_pyarrow`, `pandas`, `polars`, `pykx`). |
| `language` | string \| null | Language of the query texts: `q`, `sql` or `python`. |
| `open_source` | boolean \| null | Whether the engine is open source. |
| `sort_columns` | string[] \| null | Columns the `trade` and `quote` tables were sorted by. |
| `query_text` | object | Query `idx` -> the query as this solution wrote it. |

`query_text` is formatted for display: multi-line with indentation, to be shown
as-is in a monospace font. A few lines are longer than 100 characters, so the
display should wrap. A query the solution does not implement has no entry.

## `machines{}`

| Field | Type | Description |
|---|---|---|
| `cpu_model` | string | CPU model string, e.g. `AMD EPYC 9575F 64-Core Processor`. |
| `test_date` | string | Date of the latest run on this machine the specification was taken from. |
| `environment` | object | The full machine specification, with sections `os`, `cpu` and `memory`. |

`environment` keeps the keys and values exactly as the benchmark recorded them,
for example:

```json
{
  "os":     { "name": "Linux", "kernel": "5.14.0-503.40.1.el9_5.x86_64",
              "TransparentHugePages": "always", "TransparentHugePagesDefrag": "madvise",
              "NumaBalancing": "1" },
  "cpu":    { "Arch": "x86_64", "Model": "AMD EPYC 9575F 64-Core Processor",
              "SocketNr": 2, "CoresPerSocket": 64, "ThreadsPerCore": 2,
              "SimultaneousMultithreading": "1", "NumaNodeNr": "2",
              "L1dCache": "6 MiB (128 instances)", "L2Cache": "128 MiB (128 instances)",
              "L3Cache": "512 MiB (16 instances)",
              "FrequencyScaling": { "ScalingGovernor": "userspace", "Boost": "1",
                                    "EnergyPerformancePreference": "", "MaxFreqMHz": "5008" } },
  "memory": { "TotalGB": 2266, "DIMMCount": "24", "DIMMSize": "96 GB", "Type": "DDR5",
              "Speed": "6400 MT/s", "ConfiguredSpeed": "6000 MT/s", "ZoneReclaimMode": "0" }
}
```

New keys may appear; a reader should display whatever is there.

## `runs[]`

One entry per (`solution`, `machine`, `datadate`, `numa_node`).

| Field | Type | Description |
|---|---|---|
| `solution` | string | Key into `solutions`. |
| `machine` | string | Key into `machines`. |
| `datadate` | string | Trading day of the NYSE TAQ data the run used. |
| `numa_node` | string | NUMA node the run was pinned to (`"0"`, `"1"`, ...), or `"all"` when it was not pinned. |
| `test_date` | string | Date of the latest measurement in the run. |
| `engine_version` | string \| null | Version of the engine library. |
| `exit_code` | integer | `0` for a run that produced results; otherwise the exit status of a run that failed before running any query (`137`: killed by the operating system, usually for running out of memory). |
| `data_size_mb` | number \| null | Size of the loaded tables in memory. `null` for a failed run. |
| `peak_memory_kb` | integer \| null | Peak resident memory of the process. `null` for a failed run. |
| `threads` | object | Thread count -> measurements. Empty for a failed run. |

### `runs[].threads{}`

| Field | Type | Description |
|---|---|---|
| `load_ns` | object | Load phase (from `load_phases`) -> time. A phase the solution does not have is absent. |
| `query_ns` | object | Query `idx` -> `[cold, warm1, warm2]`: three consecutive executions, the first after a cache flush. Only queries that succeeded are present. |
| `query_status` | object | Query `idx` -> why it has no times. Absent when every query succeeded. |

`query_status` values:

| Status | Meaning |
|---|---|
| `error` | The query raised an error. |
| `skip` | The query exists but was deliberately not run for this solution: it is commented out in the solution's query file. |
| `emptyquery` | The solution has no implementation of the query. |

A query `idx` in neither `query_ns` nor `query_status` was not run in this
measurement.

## Example

```json
{
  "schema_version": 1,
  "size": "full",
  "generated_at": "2026-10-25T08:27:00Z",
  "load_phases": ["load", "transform", "sort", "index"],
  "tags": { "timefilter": "the query filters on the time column" },
  "queries": [
    { "idx": 1, "description": "select all quotes before 8am",
      "tags": ["rawcolumn", "timefilter"], "instrument": "all", "complexity": "simple" }
  ],
  "solutions": {
    "KDB-X": { "engine": "q-sql", "language": "q", "open_source": false,
               "sort_columns": ["time"],
               "query_text": { "1": "select from quote where time<0D8" } }
  },
  "machines": {
    "AMD_EPYC_9575F": { "cpu_model": "AMD EPYC 9575F 64-Core Processor",
                        "test_date": "2026-09-08", "environment": { "os": {}, "cpu": {}, "memory": {} } }
  },
  "runs": [
    { "solution": "KDB-X", "machine": "AMD_EPYC_9575F", "datadate": "2026-04-01",
      "numa_node": "0", "test_date": "2026-09-03", "engine_version": "2026.07.06",
      "exit_code": 0, "data_size_mb": 323984.13, "peak_memory_kb": 482067440,
      "threads": {
        "16": { "load_ns": { "load": 4979078620, "transform": 0,
                             "sort": 419407149349, "index": 1671689280 },
                "query_ns": { "1": [275913376, 276753315, 277085437] },
                "query_status": { "24": "error" } } } },
    { "solution": "DuckDB (Index)", "machine": "AMD_EPYC_9575F", "datadate": "2026-04-01",
      "numa_node": "0", "test_date": "2026-08-26", "engine_version": "1.5.4",
      "exit_code": 137, "data_size_mb": null, "peak_memory_kb": null, "threads": {} }
  ]
}
```
