"""
Shared machinery of the two chDB (embedded ClickHouse) in-memory executors.

Both run the same ClickHouse SQL from artifacts/queries/inmemory/chdb.psv in one
chDB session. They differ in where the data they query lives -- which the query
file's {name} table placeholders abstract away -- and, with it, in the form a
query's result takes, each staying in the memory layout its tables are in:

  * chdb.py         -- ClickHouse Memory tables, named directly (FROM trade),
                       loaded from the Parquet files by ClickHouse itself; the
                       result stays in ClickHouse's own memory as the temporary
                       table `res`, see ChDBQueryResult.
  * chdb_pyarrow.py -- Apache Arrow tables, scanned through chDB's Python()
                       table function (FROM Python(trade)); the result comes
                       back as an Arrow table.

In both, time-of-day columns are IntervalNanosecond, so queries compare and
bucket them with INTERVAL literals and nanosecond arithmetic rather than
DateTime64 timestamps, and the rows of the sorted trade and quote tables are
numbered in a rowid column, matching DuckDB's implicit rowid after its
ORDER BY ..., rowid rebuild.

The chDB session carries the settings both executors run with: session_timezone
is 'UTC', so that any date/time functions behave consistently regardless of the
host timezone, and max_threads is the thread pool size of every query.

Environment variables:
  CHDB_THREADS (optional) Number of threads (ClickHouse max_threads) per query.
"""
import logging
import os
import time
from datetime import date
from pathlib import Path
from typing import Any

import pyarrow as pa
import pyarrow.compute as pc
from chdb.session import Session

logger = logging.getLogger(__name__)


class ChDBQueryResult:
    """The result of a query, as the driver needs it.

    A query leaves its result in ClickHouse's own memory, as the temporary table
    `res` -- the counterpart of the DuckDB executor's CREATE TABLE res, which
    the driver wraps as a relation -- so that the measured section holds nothing
    but ClickHouse's own work: the query, and its result in ClickHouse's own
    layout. A temporary table is a Memory table whose metadata lives with the
    session rather than on disk, which is what makes it usable here: a plain
    CREATE TABLE writes its metadata out, and those ~6ms would land inside the
    measured section of every query, dwarfing the very conversion cost this
    avoids for the fast ones.

    What the driver asks of the result afterwards is served from here, all of it
    outside the measured section: the shape and the size are read from the
    session, and the rows themselves -- only ever needed to write the query
    output -- by running the query again, since the table does not keep the row
    order the query produced (the branches of a UNION ALL, for one, are inserted
    independently, and the query output is compared across engines row by row).
    """

    # The table a result is materialised as; dropped again before every run.
    NAME: str = "res"

    def __init__(self, executor: "QueryExecutorChDBBase", sql: str) -> None:
        self._executor = executor
        self._sql = sql

    @property
    def shape(self) -> tuple[int, int]:
        rows = self._executor._query(
            "SELECT total_rows AS rows FROM system.tables"
            f" WHERE is_temporary AND name = '{self.NAME}'", "ArrowTable")["rows"][0].as_py()
        return rows, self._executor._query(f"DESCRIBE TABLE {self.NAME}", "ArrowTable").num_rows

    @property
    def nbytes(self) -> int:
        return self._executor._query(
            "SELECT total_bytes AS bytes FROM system.tables"
            f" WHERE is_temporary AND name = '{self.NAME}'", "ArrowTable")["bytes"][0].as_py()

    def arrow(self) -> pa.Table:
        """The rows, from a re-run of the query, whose order the table does not keep."""
        return self._executor._query(self._sql, "ArrowTable")


class QueryExecutorChDBBase:
    """
    Handles the setup and execution shared by the chDB executors. Where the data
    lives is left to the subclasses' _table_ref, _add_timebuckets, _load,
    _transform_tables, _sort_tables, _post_sort, _tables_size_kb and
    _table_stats implementations.
    """

    # The tables the queries can name through their {name} placeholders.
    TABLES: tuple[str, ...] = ("master", "trade", "quote", "exnames", "timeBuckets")
    # The tables whose size and schema are reported to the driver.
    REPORTED_TABLES: tuple[str, ...] = ("master", "trade", "quote")
    # The tables that are sorted and numbered with a rowid.
    SORTED_TABLES: tuple[str, ...] = ("trade", "quote")

    def __init__(self, param: dict[str, Any], sort_cols: list[str], datadate: date) -> None:
        self.params: dict[str, Any] = param
        self.sort_cols: list[str] = sort_cols
        # One chDB instance for the whole run, so no query pays for building
        # (and tearing down) its own; the Memory tables live in it too.
        self.session: Session = Session()

        # Settings of the session, so they hold for every query and every load
        # step: max_threads is chDB's thread pool size, and session_timezone
        # keeps any date/time function independent of the host timezone.
        self._query("SET session_timezone = 'UTC'", "CSV")
        if 'CHDB_THREADS' in os.environ:
            self._query(f"SET max_threads = {int(os.environ['CHDB_THREADS'])}", "CSV")
        self.threads: int = int(str(self._query(
            "SELECT getSetting('max_threads')", "CSV")).strip())

        self._add_timebuckets([
            (bucket, (d.days * 86_400 + d.seconds) * 1_000_000_000 + d.microseconds * 1_000)
            for bucket, d in self.params.pop('timeBuckets').items()])
        # Query parameters and table references pre-rendered as SQL, interpolated
        # into the queries' {name} placeholders with str.format.
        self.sql_params: dict[str, str] = {k: self._sql_literal(v) for k, v in self.params.items()}
        self.sql_params.update({t: self._table_ref(t) for t in self.TABLES})

    def _query(self, sql: str, fmt: str):
        """Run a query in the session the whole run shares."""
        return self.session.query(sql, fmt)

    def _table_ref(self, name: str) -> str:
        """How the queries reach the table `name`."""
        raise NotImplementedError

    def _add_timebuckets(self, rows: list[tuple[str, int]]) -> None:
        """Store the timeBuckets lookup -- (bucket name, bound in nanoseconds)
        pairs, numbered by a rowid -- as a queryable table."""
        raise NotImplementedError

    def _load(self, db_path: Path, datadate: date) -> None:
        """Read exnames, master, trade and quote into memory."""
        raise NotImplementedError

    def _transform_tables(self) -> None:
        """Bring the loaded tables to the types the queries expect."""
        raise NotImplementedError

    def _sort_tables(self) -> None:
        """Order SORTED_TABLES by sort_cols."""
        raise NotImplementedError

    def _post_sort(self) -> None:
        """Transform work that has to run after the sort, e.g. numbering the rows
        of the sorted tables. Its cost is reported with the transform step."""

    def _tables_size_kb(self) -> int:
        """Total size of the reported tables, as written into the setup rows."""
        raise NotImplementedError

    def _table_stats(self, name: str) -> dict[str, Any]:
        """Name, size, row/column count and column types of one reported table."""
        raise NotImplementedError

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
        t_load, io_load = self._timed(ios, lambda: self._load(db_path, datadate))
        writer.writerow(row_start + [0, "load a partition into memory", "success", t_load, None, None,
                         None, io_load, None, None, self._tables_size_kb()])

        t_transform, io_transform = self._timed(ios, self._transform_tables)
        t_sort, io_sort = self._timed(ios, self._sort_tables)
        # Whatever _post_sort does is transform work that only has to wait for
        # the sort, so its cost belongs to the transform row.
        t_post, io_post = self._timed(ios, self._post_sort)

        writer.writerow(row_start + [-1, "transform", "success", t_transform + t_post, None, None,
                         None, io_transform + io_post, None, None, self._tables_size_kb()])
        writer.writerow(row_start + [-2, "sort", "success", t_sort, None, None,
                         None, io_sort, None, None, self._tables_size_kb()])

    @staticmethod
    def get_table_size(df: pa.Table | ChDBQueryResult) -> int:
        return df.nbytes // 1024

    def get_table_stats(self) -> dict[str, Any]:
        import importlib.metadata
        table_stats_dict = {"proprietary": "no"}
        table_stats_dict["engineversion"] = importlib.metadata.version('chdb')
        for t_name in self.REPORTED_TABLES:
            table_stats_dict[t_name] = self._table_stats(t_name)
        return table_stats_dict

    def prepare_run(self) -> None:
        """Drop the previous result, so a run never holds two of them."""
        self._query(f"DROP TEMPORARY TABLE IF EXISTS {ChDBQueryResult.NAME}", "CSV")

    def get_parameters(self, query_str: str, parameter: str) -> str:
        """Render the final SQL by interpolating the parameter literals and the
        table references; the settings are the session's."""
        return query_str.format(**self.sql_params)

    @classmethod
    def _sql_literal(cls, value: Any) -> str:
        if isinstance(value, str):
            return "'" + value.replace("'", "''") + "'"
        if isinstance(value, date):
            return f"toDateTime64('{value} 00:00:00', 9)"
        if isinstance(value, (list, tuple)):
            return "(" + ", ".join(cls._sql_literal(v) for v in value) + ")"
        return str(value)

    def execute_query(self, idx: int, tags: set, query_str: str, sql: str, runidx: int):
        """Run the query, leaving its result in ClickHouse's own memory.

        The result is materialised as a table (Memory, as temporary tables are)
        rather than returned in a format of ours, so that the measured time is
        ClickHouse's query and its result, and not a conversion into someone
        else's memory layout on top -- the same deal the DuckDB executor's
        CREATE TABLE res gets. What the driver reads from the returned handle it
        reads afterwards; see ChDBQueryResult.
        """
        try:
            self._query(f"CREATE TEMPORARY TABLE {ChDBQueryResult.NAME} AS {sql}", "CSV")
        except Exception as e:
            logger.error("query execution failed: %s", e)
            raise
        return ChDBQueryResult(self, sql)

    @staticmethod
    def _fmt_duration(col: pa.ChunkedArray, name: str) -> pa.ChunkedArray:
        """Format a duration column as a kdb-style timespan string, 0DHH:MM:SS.nnnnnnnnn.

        The "minute" column is rendered without the 0D day prefix.
        """
        ns = pc.cast(col, pa.int64())
        def pad(values: pa.ChunkedArray, width: int) -> pa.ChunkedArray:
            return pc.utf8_lpad(pc.cast(values, pa.string()), width, '0')
        def divmod_(x: pa.ChunkedArray, d: int) -> tuple[pa.ChunkedArray, pa.ChunkedArray]:
            q = pc.divide(x, d)
            return q, pc.subtract(x, pc.multiply(q, d))
        secs, subsec = divmod_(ns, 1_000_000_000)
        mins, ss = divmod_(secs, 60)
        hh, mm = divmod_(mins, 60)
        prefix = '' if name == 'minute' else '0D'
        return pc.binary_join_element_wise(prefix, pad(hh, 2), ':', pad(mm, 2), ':', pad(ss, 2), '.', pad(subsec, 9), '')

    def write_csv(self, res: ChDBQueryResult, out_file: Path) -> None:
        self._write_arrow_csv(res.arrow(), out_file)

    def _write_arrow_csv(self, rows: pa.Table, out_file: Path) -> None:
        """Write the result rows, from whichever form the executor's results take."""
        import pyarrow.csv as pa_csv
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
