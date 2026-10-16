"""
ClickHouse in-memory query executor over MergeTree tables.

The queries run in a ClickHouse server that the executor starts as its own child
process (CLICKHOUSE_BINARY), so any ClickHouse build can be benchmarked, e.g. the
latest one from `curl https://clickhouse.com/ | sh`. Being a child of the runner,
the server's peak memory is the one /usr/bin/time reports. The queries are sent
over the HTTP interface in one session, which carries the settings of the run:
session_timezone is 'UTC', so that date/time functions do not depend on the host
timezone, max_threads is CLICKHOUSE_THREADS, and the query condition cache is off,
so that a warm run cannot skip the granules an earlier run filtered out. The round
trip over the loopback interface (~0.1 ms) is part of every measured query.

trade and quote are MergeTree tables whose sorting key is sortcols (sym, time):
the primary index narrows every filter on an instrument -- and on a time range
within it -- down to the granules that can match, which is the counterpart of
the KDB-X `sym` attribute and the DuckDB index on sym. The tables are kept on
tmpfs (CLICKHOUSE_PATH, /dev/shm by default), so the data stays in memory, as for
every other engine of this in-memory benchmark, and their primary index and marks
are loaded when they are built rather than on their first use, which would
otherwise land in the cold run. The small tables (master, exnames, timeBuckets)
are Memory tables.

The rows are numbered in a rowid column in time order (ties broken by the
position of the row in the Parquet files), as in the time-sorted tables of the
other engines; it is only the physical order of the rows that follows the
sorting key. The queries reference rowid wherever they need the time order, so
their results are the same as those of the other engines. Time-of-day columns are
IntervalNanosecond, and the queries compare them with literals of the same unit
(toIntervalNanosecond), which the primary index can use.

The load steps:

  * load      -- each Parquet partition into a MergeTree staging table sorted by
                 (time, Parquet file position, Parquet row number), which the
                 MergeTree builds by merging sorted runs, so the whole table is
                 never sorted in memory at once.
  * transform -- the types the queries expect: IntervalNanosecond for the
                 time-of-day columns (the Parquet reader sees plain Int64
                 nanoseconds) and LowCardinality for the string columns the
                 Parquet files hold dictionary-encoded (all but master's
                 free-text description). For trade and quote this happens on
                 the way into their final tables, in the sort step.
  * sort      -- trade and quote rebuilt from the staging tables, read in their
                 sorting key order, so that rowNumberInAllBlocks() numbers the
                 rows in time order, into MergeTree tables with sortcols as the
                 sorting key, merged into a single part.

A query leaves its result in ClickHouse's own memory, as the temporary table
`res` -- the counterpart of the DuckDB executor's CREATE TABLE res -- so that the
measured time is ClickHouse's query and its result, and not a conversion into
another memory layout on top. See ClickHouseQueryResult.

Environment variables:
  CLICKHOUSE_BINARY  (optional) Path to the clickhouse binary, `clickhouse` (from PATH) by default.
  CLICKHOUSE_THREADS (optional) Number of threads (ClickHouse max_threads) per query.
  CLICKHOUSE_PATH    (optional) Directory of the server's data, /dev/shm/clickhouse_benchmark
                     by default. It is removed at the start and at the end of the run.
  CLICKHOUSE_PORT    (optional) HTTP port of the server, 18123 by default.
"""
import atexit
import http.client
import logging
import os
import shutil
import subprocess
import time
import urllib.parse
import uuid
from datetime import date
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc

logger = logging.getLogger(__name__)


class ClickHouseServer:
    """A ClickHouse server child process and an HTTP session in it."""

    def __init__(self, binary: str, path: Path, port: int, user_files_path: Path) -> None:
        shutil.rmtree(path, ignore_errors=True)
        path.mkdir(parents=True)
        self.path = path
        config = path / "config.xml"
        config.write_text(f"""<clickhouse>
    <logger><level>warning</level><log>{path}/server.log</log><errorlog>{path}/server.err.log</errorlog></logger>
    <http_port>{port}</http_port>
    <listen_host>127.0.0.1</listen_host>
    <path>{path}/data/</path>
    <tmp_path>{path}/tmp/</tmp_path>
    <user_files_path>{user_files_path}/</user_files_path>
    <max_session_timeout>86400</max_session_timeout>
    <keep_alive_timeout>86400</keep_alive_timeout>
    <mark_cache_size>5368709120</mark_cache_size>
    <users>
        <default>
            <password></password>
            <networks><ip>127.0.0.1</ip></networks>
            <profile>default</profile>
            <quota>default</quota>
            <access_management>1</access_management>
        </default>
    </users>
    <profiles><default></default></profiles>
    <quotas><default></default></quotas>
</clickhouse>
""")
        self.process = subprocess.Popen([binary, "server", "--config-file", str(config)],
                                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        atexit.register(self.stop)
        self.session_id = uuid.uuid4().hex
        self.connection = http.client.HTTPConnection("127.0.0.1", port)
        deadline = time.monotonic() + 120
        while True:
            if self.process.poll() is not None:
                raise RuntimeError(f"clickhouse server exited with {self.process.returncode}, see {path}/server.err.log")
            try:
                self.query("SELECT 1", "CSV")
                break
            except (ConnectionError, OSError):
                if time.monotonic() > deadline:
                    raise
                self.connection.close()
                time.sleep(0.1)

    def query(self, sql: str, fmt: str):
        """Run a query in the session: an Arrow table for fmt 'ArrowTable', the text otherwise."""
        params = urllib.parse.urlencode({"session_id": self.session_id, "session_timeout": 86400,
                                         "default_format": "ArrowStream" if fmt == "ArrowTable" else fmt})
        self.connection.request("POST", f"/?{params}", body=sql.encode())
        response = self.connection.getresponse()
        body = response.read()
        if response.status != 200:
            raise RuntimeError(body.decode(errors="replace"))
        if fmt == "ArrowTable":
            return pa.ipc.open_stream(body).read_all() if body else pa.table({})
        return body.decode()

    def stop(self) -> None:
        if self.process.poll() is None:
            self.process.terminate()
            self.process.wait()
        shutil.rmtree(self.path, ignore_errors=True)


class ClickHouseQueryResult:
    """The result of a query, as the driver needs it.

    The result is the temporary table `res`, a Memory table whose metadata lives
    with the session rather than on disk; a plain CREATE TABLE would write its
    metadata out inside the measured section of every query. What the driver asks
    of the result afterwards is served from here, outside the measured section:
    the shape and the size are read from the server, and the rows themselves --
    only ever needed to write the query output -- by running the query again,
    since the table does not keep the row order the query produced.
    """

    # The table a result is materialised as; dropped again before every run.
    NAME: str = "res"

    def __init__(self, executor: "QueryExecutorClickHouse", sql: str) -> None:
        self._executor = executor
        self._sql = sql

    def _info(self, column: str) -> int:
        return self._executor._query(
            f"SELECT {column} AS value FROM system.tables"
            f" WHERE is_temporary AND name = '{self.NAME}'", "ArrowTable")["value"][0].as_py()

    @property
    def shape(self) -> tuple[int, int]:
        return self._info("total_rows"), self._executor._query(f"DESCRIBE TABLE {self.NAME}", "ArrowTable").num_rows

    @property
    def nbytes(self) -> int:
        return self._info("total_bytes")

    def arrow(self) -> pa.Table:
        """The rows, from a re-run of the query, whose order the table does not keep."""
        return self._executor._query(self._sql, "ArrowTable")


class QueryExecutorClickHouse:
    """
    Handles the setup, execution of ClickHouse queries over MergeTree tables.
    """

    # The tables the queries can name through their {name} placeholders.
    TABLES: tuple[str, ...] = ("master", "trade", "quote", "exnames", "timeBuckets")
    # The tables whose size and schema are reported to the driver.
    REPORTED_TABLES: tuple[str, ...] = ("master", "trade", "quote")
    # The tables that are MergeTree tables sorted by sortcols and numbered with a rowid.
    SORTED_TABLES: tuple[str, ...] = ("trade", "quote")
    # The time-of-day columns each table stores as int64 nanoseconds. Parquet
    # keeps their duration[ns] type in the Arrow schema only, which ClickHouse
    # does not read, so they are named here -- see the time_cols arguments of
    # pysrc/taqToParquet/table_converters.py.
    DURATION_COLUMNS: dict[str, tuple[str, ...]] = {
        "master": (),
        "trade": ("time", "participantTimestamp", "tradeReportingFacilityTRFTimestamp"),
        "quote": ("time", "participantTimestamp", "FINRAADFTimestamp"),
    }
    # The string columns left unencoded, being unencoded in the other engines
    # too: master's free-text description, which the Parquet schema keeps a
    # plain string where every other string column of the table is
    # dictionary-encoded -- see pysrc/taqToParquet/schemas.py.
    PLAIN_STRING_COLUMNS: dict[str, tuple[str, ...]] = {"master": ("description",)}
    # The Parquet row position, kept on the staging tables: the position of the
    # file the row was read from in the sorted file names, and its row number in it.
    SRC_FILE: str = "_src_file"
    SRC_ROW: str = "_src_row"
    ROW_POSITION: tuple[str, ...] = (SRC_FILE, SRC_ROW)
    # The order the rows are numbered in by rowid: the order of the time-sorted
    # tables of the other engines, whatever the sorting key of the table is.
    ROWID_ORDER: tuple[str, ...] = ("time",)
    # The final tables hold their primary index and marks in memory from the
    # moment they are built, as the data itself is.
    TABLE_SETTINGS: str = "prewarm_mark_cache = 1, primary_key_lazy_load = 0"

    def __init__(self, param: dict[str, Any], sort_cols: list[str], datadate: date, db_path: Path) -> None:
        if not sort_cols:
            raise ValueError("MergeTree tables need -sortcols for their sorting key")
        self.params: dict[str, Any] = param
        self.sort_cols: list[str] = sort_cols
        self.server = ClickHouseServer(
            os.environ.get('CLICKHOUSE_BINARY', 'clickhouse'),
            Path(os.environ.get('CLICKHOUSE_PATH', '/dev/shm/clickhouse_benchmark')),
            int(os.environ.get('CLICKHOUSE_PORT', '18123')),
            db_path.resolve())

        self._query("SET session_timezone = 'UTC'", "CSV")
        self._query("SET use_query_condition_cache = 0", "CSV")
        if 'CLICKHOUSE_THREADS' in os.environ:
            self._query(f"SET max_threads = {int(os.environ['CLICKHOUSE_THREADS'])}", "CSV")
        self.threads: int = int(self._query("SELECT getSetting('max_threads')", "CSV").strip())

        self._add_timebuckets([
            (bucket, (d.days * 86_400 + d.seconds) * 1_000_000_000 + d.microseconds * 1_000)
            for bucket, d in self.params.pop('timeBuckets').items()])
        # Query parameters and table references pre-rendered as SQL, interpolated
        # into the queries' {name} placeholders with str.format.
        self.sql_params: dict[str, str] = {k: self._sql_literal(v) for k, v in self.params.items()}
        self.sql_params.update({t: t for t in self.TABLES})

    def _query(self, sql: str, fmt: str):
        return self.server.query(sql, fmt)

    def _add_timebuckets(self, rows: list[tuple[str, int]]) -> None:
        """Store the timeBuckets lookup -- (bucket name, bound in nanoseconds)
        pairs, numbered by a rowid -- as a Memory table."""
        self._query("CREATE TABLE timeBuckets (bucket Nullable(String),"
                    " bound Nullable(IntervalNanosecond), rowid Nullable(UInt64))"
                    " ENGINE = Memory", "CSV")
        values = ", ".join(
            f"({self._sql_literal(bucket)}, toIntervalNanosecond({bound}), {rowid})"
            for rowid, (bucket, bound) in enumerate(rows))
        self._query(f"INSERT INTO timeBuckets VALUES {values}", "CSV")

    @staticmethod
    def _timed(ios, step) -> tuple[int, int]:
        """Run a load step and return its elapsed time in ns and its IO in KB."""
        io_start = ios.get_io_stat()
        t_start = time.perf_counter_ns()
        step()
        t_end = time.perf_counter_ns()
        return t_end - t_start, ios.get_io_stat() - io_start

    def load_resources(self, db_path: Path, datadate: date, writer, row_start, ios) -> None:
        logger.info("loading hive-partitioned tables at %s", db_path)
        t_load, io_load = self._timed(ios, lambda: self._load(db_path.resolve(), datadate))
        writer.writerow(row_start + [0, "load a partition into memory", "success", t_load, None, None,
                         None, io_load, None, None, self._tables_size_kb()])
        t_transform, io_transform = self._timed(ios, self._transform_tables)
        t_sort, io_sort = self._timed(ios, self._sort_tables)
        writer.writerow(row_start + [-1, "transform", "success", t_transform, None, None,
                         None, io_transform, None, None, self._tables_size_kb()])
        writer.writerow(row_start + [-2, "sort", "success", t_sort, None, None,
                         None, io_sort, None, None, self._tables_size_kb()])

    def _load(self, db_path: Path, datadate: date) -> None:
        partition = {name: db_path / name / f"date={datadate}" / "*.parquet"
                     for name in self.REPORTED_TABLES}
        for name, src in {"exnames": db_path / "exnames.parquet", **partition}.items():
            logger.info("loading %s", name)
            select = f"SELECT * FROM file({self._sql_literal(str(src))}, Parquet)"
            settings = " SETTINGS use_hive_partitioning = 0"
            if name not in self.SORTED_TABLES:
                self._query(f"CREATE TABLE {name} ENGINE = Memory AS {select}{settings}", "CSV")
                continue
            # The file's position in the sorted file names rather than its name, so
            # that the tie-break of the sort compares an integer.
            files = sorted(p.name for p in src.parent.glob(src.name))
            array = "[" + ", ".join(self._sql_literal(f) for f in files) + "]"
            self._query(
                f"CREATE TABLE {name} ENGINE = MergeTree"
                f" ORDER BY ({', '.join(self.ROWID_ORDER + self.ROW_POSITION)})"
                " SETTINGS allow_nullable_key = 1"
                f" AS SELECT *, toUInt32(indexOf({array}, _file)) AS {self.SRC_FILE},"
                f" _row_number AS {self.SRC_ROW}"
                f" FROM file({self._sql_literal(str(src))}, Parquet){settings}", "CSV")

    def _transformations(self, name: str) -> dict[str, str]:
        """The expressions that bring each column of the table to the type the queries expect."""
        replace = {c: f"toIntervalNanosecond({c})" for c in self.DURATION_COLUMNS[name]}
        plain = self.PLAIN_STRING_COLUMNS.get(name, ())
        replace |= {c: f"CAST({c} AS LowCardinality(Nullable(String)))"
                    for c in self._columns(name, of_type="Nullable(String)") if c not in plain}
        return replace

    def _transform_tables(self) -> None:
        logger.info("applying transformations")
        for name in self.REPORTED_TABLES:
            if name in self.SORTED_TABLES:
                continue  # Transformed by the sort step, on the way into the final table.
            replace = ", ".join(f"{e} AS {c}" for c, e in self._transformations(name).items())
            self._query(f"CREATE TABLE {name}_next ENGINE = Memory AS SELECT * REPLACE ({replace}) FROM {name}", "CSV")
            self._swap(name)
            logger.info("Shape of %s: %s x %s", name, *self._shape(name))

    def _sort_tables(self) -> None:
        for name in self.SORTED_TABLES:
            for c in self.sort_cols:
                nulls = int(self._query(f"SELECT countIf(isNull({c})) FROM {name}", "CSV").strip())
                if nulls:
                    raise ValueError(f"{name}.{c} has {nulls} NULLs, it cannot be a part of the sorting key")
            replace = self._transformations(name)
            # The sorting key columns are not Nullable, having no NULLs.
            for c in self.sort_cols:
                replace[c] = f"assumeNotNull({replace.get(c, c)})"
            replace = ", ".join(f"{e} AS {c}" for c, e in replace.items())
            order_by = ", ".join(self.ROWID_ORDER + self.ROW_POSITION)
            logger.info("building %s ordered by %s, numbered by %s", name, ", ".join(self.sort_cols), order_by)
            self._query(
                f"CREATE TABLE {name}_next ENGINE = MergeTree ORDER BY ({', '.join(self.sort_cols)})"
                f" SETTINGS {self.TABLE_SETTINGS}"
                f" AS SELECT * EXCEPT ({', '.join(self.ROW_POSITION)}) REPLACE ({replace}),"
                " rowNumberInAllBlocks() AS rowid"
                f" FROM (SELECT * FROM {name} ORDER BY {order_by})"
                " SETTINGS optimize_read_in_order = 1", "CSV")
            self._query(f"OPTIMIZE TABLE {name}_next FINAL", "CSV")
            self._swap(name)
            logger.info("Shape of %s: %s x %s", name, *self._shape(name))

    def _swap(self, name: str) -> None:
        """Replace the table `name` with `name`_next, built from it."""
        self._query(f"DROP TABLE {name} SYNC", "CSV")
        self._query(f"RENAME TABLE {name}_next TO {name}", "CSV")

    def _columns(self, name: str, of_type: str | None = None) -> list[str]:
        """The table's column names in order, optionally only those of one type."""
        res = self._query(
            "SELECT name FROM system.columns WHERE database = currentDatabase()"
            f" AND table = {self._sql_literal(name)}"
            + (f" AND type = {self._sql_literal(of_type)}" if of_type else "")
            + " ORDER BY position", "ArrowTable")
        return res["name"].to_pylist() if res.num_rows else []

    def _table_info(self, name: str) -> tuple[int, int]:
        """The table's row count and size in bytes (compressed, for the MergeTree tables)."""
        res = self._query(
            "SELECT total_rows, total_bytes FROM system.tables"
            f" WHERE database = currentDatabase() AND name = {self._sql_literal(name)}", "ArrowTable")
        return res["total_rows"][0].as_py(), res["total_bytes"][0].as_py()

    def _shape(self, name: str) -> tuple[int, int]:
        return self._table_info(name)[0], len(self._columns(name))

    def _tables_size_kb(self) -> int:
        return sum(self._table_info(t)[1] for t in self.REPORTED_TABLES) // 1024

    def get_engine_stats(self) -> dict[str, Any]:
        return {"proprietary": "no",
                "engineversion": self._query("SELECT version()", "CSV").strip().strip('"')}

    def get_table_stats(self) -> dict[str, Any]:
        """The per-table sections, appended to the stats.yaml get_engine_stats started."""
        stats: dict[str, Any] = {}
        for name in self.REPORTED_TABLES:
            rows, size = self._table_info(name)
            desc = self._query(f"DESCRIBE TABLE {name}", "ArrowTable")
            stats[name] = {
                "name": name,
                "size (MB)": size / 1024 / 1024,
                "rowCount": rows,
                "columnCount": desc.num_rows,
                "columns": [{"name": n, "type": t}
                            for n, t in zip(desc["name"].to_pylist(), desc["type"].to_pylist())],
            }
        return stats

    @staticmethod
    def get_table_size(df: ClickHouseQueryResult) -> int:
        return df.nbytes // 1024

    def prepare_run(self) -> None:
        """Drop the previous result, so a run never holds two of them."""
        self._query(f"DROP TEMPORARY TABLE IF EXISTS {ClickHouseQueryResult.NAME}", "CSV")

    def get_parameters(self, query_str: str, parameter: str) -> str:
        """Render the final SQL by interpolating the parameter literals and the
        table references; the settings are the session's."""
        return query_str.format(**self.sql_params)

    @classmethod
    def _sql_literal(cls, value: Any) -> str:
        if isinstance(value, str):
            return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"
        if isinstance(value, date):
            return f"toDateTime64('{value} 00:00:00', 9)"
        if isinstance(value, (list, tuple)):
            return "(" + ", ".join(cls._sql_literal(v) for v in value) + ")"
        return str(value)

    def execute_query(self, idx: int, tags: set, query_str: str, sql: str, runidx: int):
        """Run the query, leaving its result in ClickHouse's own memory."""
        try:
            self._query(f"CREATE TEMPORARY TABLE {ClickHouseQueryResult.NAME} AS {sql}", "CSV")
        except Exception as e:
            logger.error("query execution failed: %s", e)
            raise
        return ClickHouseQueryResult(self, sql)

    @staticmethod
    def _fmt_duration(col: pa.ChunkedArray, name: str) -> pa.ChunkedArray:
        """Format a duration column as a kdb-style timespan string, 0DHH:MM:SS.nnnnnnnnn.

        The "minute" column is rendered without the 0D day prefix. The strings are
        large_string, as a result of many rows overflows the 32-bit offsets of string.
        """
        ns = pc.cast(col, pa.int64())
        def pad(values: pa.ChunkedArray, width: int) -> pa.ChunkedArray:
            return pc.utf8_lpad(pc.cast(values, pa.large_string()), width, '0')
        def divmod_(x: pa.ChunkedArray, d: int) -> tuple[pa.ChunkedArray, pa.ChunkedArray]:
            q = pc.divide(x, d)
            return q, pc.subtract(x, pc.multiply(q, d))
        secs, subsec = divmod_(ns, 1_000_000_000)
        mins, ss = divmod_(secs, 60)
        hh, mm = divmod_(mins, 60)
        lit = lambda text: pa.scalar(text, pa.large_string())
        prefix = '' if name == 'minute' else '0D'
        return pc.binary_join_element_wise(lit(prefix), pad(hh, 2), lit(':'), pad(mm, 2), lit(':'), pad(ss, 2),
                                           lit('.'), pad(subsec, 9), lit(''))

    def write_csv(self, res: ClickHouseQueryResult, out_file: Path) -> None:
        import pyarrow.csv as pa_csv
        rows = res.arrow()
        columns = {}
        for f in rows.schema:
            col = rows[f.name]
            if pa.types.is_duration(f.type):
                col = self._fmt_duration(col, f.name)
            elif pa.types.is_boolean(f.type):
                col = pc.cast(col, pa.int8())
            elif pa.types.is_dictionary(f.type):
                col = pc.cast(col, f.type.value_type)
            columns[f.name] = col
        tbl = pa.table(columns)
        # Write the header ourselves and disable value quoting: pyarrow quotes
        # all string values (and header names) by default, unlike the other
        # engines' CSV writers.
        with pa.OSFile(str(out_file), 'wb') as f:
            f.write((','.join(tbl.column_names) + '\n').encode())
            pa_csv.write_csv(tbl, f, pa_csv.WriteOptions(include_header=False, quoting_style='none'))
