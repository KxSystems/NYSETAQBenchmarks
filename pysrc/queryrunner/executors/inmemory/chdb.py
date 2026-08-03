"""
chDB (embedded ClickHouse) in-memory query executor.

The tables (master, trade, quote, exnames, timeBuckets) are stored in memory
as Apache Arrow tables. Queries are ClickHouse SQL and reference the tables
through chDB's Python() table function (e.g. SELECT ... FROM Python(trade)),
which scans the Arrow data directly, so Arrow remains the storage format.

Time-of-day columns are kept as Arrow duration[ns] (surfaced by chDB as
IntervalNanosecond), so queries compare and bucket them with INTERVAL literals
and nanosecond arithmetic rather than DateTime64 timestamps.

Every query runs with session_timezone='UTC' so that any date/time functions
behave consistently regardless of the host timezone.

Environment variables:
  CHDB_THREADS (optional) Number of threads (ClickHouse max_threads) per query.
"""
import logging
import os
import time
from datetime import date
from pathlib import Path
from typing import Any

import chdb
import numpy as np
import pyarrow as pa
import pyarrow.compute as pc
import pyarrow.dataset as pa_ds

logger = logging.getLogger(__name__)


class QueryExecutorChDB:
    """
    Handles the setup, execution of chDB queries over in-memory Arrow tables.
    """

    def __init__(self, param: dict[str, Any], sort_cols: list[str], datadate: date) -> None:
        self.params: dict[str, Any] = param
        self.sort_cols: list[str] = sort_cols

        settings = ["session_timezone = 'UTC'"]
        if 'CHDB_THREADS' in os.environ:
            settings.append(f"max_threads = {int(os.environ['CHDB_THREADS'])}")
        self.settings_clause: str = " SETTINGS " + ", ".join(settings)
        self.threads: int = int(str(chdb.query(
            f"SELECT getSetting('max_threads'){self.settings_clause}", "CSV")).strip())

        timebuckets_rows = list(self.params.pop('timeBuckets').items())
        bounds = [(d.days * 86_400 + d.seconds) * 1_000_000_000 + d.microseconds * 1_000
                  for _, d in timebuckets_rows]
        self.tables: dict[str, pa.Table] = {
            "timeBuckets": pa.table({
                "bucket": pa.array([b for b, _ in timebuckets_rows]),
                "bound": pa.array(bounds, pa.duration('ns')),
                "rowid": pa.array(range(len(bounds)), pa.uint64()),
            })
        }
        # Query parameters pre-rendered as SQL literals, interpolated into the
        # queries' {name} placeholders with str.format.
        self.sql_params: dict[str, str] = {k: self._sql_literal(v) for k, v in self.params.items()}

    def _transform(self, tbl: pa.Table) -> pa.Table:
        """Dictionary-encode the sym column."""
        if 'sym' in tbl.column_names and not pa.types.is_dictionary(tbl['sym'].type):
            idx = tbl.column_names.index('sym')
            tbl = tbl.set_column(idx, 'sym', tbl['sym'].dictionary_encode())
        return tbl

    @staticmethod
    def _append_rowid(tbl: pa.Table) -> pa.Table:
        """Number the rows by their sorted position. sort_by is stable, so this
        matches DuckDB's implicit rowid after its ORDER BY ..., rowid rebuild."""
        return tbl.append_column('rowid', pa.array(np.arange(tbl.num_rows, dtype=np.uint64)))

    def load_resources(self, db_path: Path, datadate: date, writer, row_start, ios) -> None:
        logger.info("loading hive-partitioned tables at %s", db_path)

        io_load_start = ios.get_io_stat()
        t_load_start = time.perf_counter_ns()
        exnames = pa_ds.dataset(db_path / "exnames.parquet", format="parquet").to_table()
        # The date partition column is constant within the partition and the
        # time-of-day columns stay date-less durations, so it is not read.
        master = pa_ds.dataset(db_path / "master" / f"date={datadate}", format="parquet").to_table()
        logger.info("loading trade")
        trade = pa_ds.dataset(db_path / "trade" / f"date={datadate}", format="parquet").to_table()
        logger.info("loading quote")
        quote = pa_ds.dataset(db_path / "quote" / f"date={datadate}", format="parquet").to_table()
        t_load_elapsed = time.perf_counter_ns() - t_load_start
        io_load_end = ios.get_io_stat()
        writer.writerow(row_start + [0, "load a partition into memory", "success", t_load_elapsed, None, None,
                         None, io_load_end - io_load_start, None, None, sum(self.get_table_size(t) for t in (master, trade, quote))])

        io_load_start = ios.get_io_stat()
        t_load_start = time.perf_counter_ns()
        logger.info("applying transformations")
        master = self._transform(master)
        logger.info("Shape of master: %s x %s", master.shape[0], master.shape[1])
        trade = self._transform(trade)
        logger.info("Shape of trade: %s x %s", trade.shape[0], trade.shape[1])
        quote = self._transform(quote)
        logger.info("Shape of quote: %s x %s", quote.shape[0], quote.shape[1])
        t_transform_elapsed = time.perf_counter_ns() - t_load_start
        io_transform = ios.get_io_stat() - io_load_start

        io_load_start = ios.get_io_stat()
        t_load_start = time.perf_counter_ns()
        logger.info("ordering trade by %s", ", ".join(self.sort_cols))
        trade = trade.sort_by([(c, 'ascending') for c in self.sort_cols])
        logger.info("ordering quote by %s", ", ".join(self.sort_cols))
        quote = quote.sort_by([(c, 'ascending') for c in self.sort_cols])
        t_sort_elapsed = time.perf_counter_ns() - t_load_start
        io_sort = ios.get_io_stat() - io_load_start

        # rowid is transform work, but it has to run after the sort so it
        # numbers rows by sorted position; fold its cost into the transform row.
        io_load_start = ios.get_io_stat()
        t_load_start = time.perf_counter_ns()
        trade = self._append_rowid(trade)
        quote = self._append_rowid(quote)
        t_transform_elapsed += time.perf_counter_ns() - t_load_start
        io_transform += ios.get_io_stat() - io_load_start

        writer.writerow(row_start + [-1, "transform", "success", t_transform_elapsed, None, None,
                         None, io_transform, None, None, sum(self.get_table_size(t) for t in (master, trade, quote))])
        writer.writerow(row_start + [-2, "sort", "success", t_sort_elapsed, None, None,
                         None, io_sort, None, None, sum(self.get_table_size(t) for t in (master, trade, quote))])

        self.tables["exnames"] = exnames
        self.tables["master"] = master
        self.tables["trade"] = trade
        self.tables["quote"] = quote

    @staticmethod
    def get_table_size(df: pa.Table) -> int:
        return df.nbytes // 1024

    @classmethod
    def _type_str(cls, t: pa.DataType) -> str:
        """Arrow prints float32 as 'float' and float64 as 'double'; persist unambiguous names."""
        if pa.types.is_dictionary(t):
            return f"dictionary<{cls._type_str(t.value_type)}>"
        if pa.types.is_floating(t):
            return f"float{t.bit_width}"
        return str(t)

    def get_table_stats(self) -> dict[str, Any]:
        import importlib.metadata
        table_stats_dict = {"proprietary": "no"}
        table_stats_dict["engineversion"] = importlib.metadata.version('chdb')
        for t_name in ["master", "trade", "quote"]:
            df = self.tables[t_name]
            fields = list(df.schema)
            table_stats = {
                "name": t_name,
                "size (MB)": self.get_table_size(df) / 1024,
                "rowCount": df.shape[0],
                "columnCount": len(fields),
                "columns": [
                    {"name": f.name, "type": self._type_str(f.type)}
                    for f in fields
                ],
            }
            table_stats_dict[t_name] = table_stats
        return table_stats_dict

    def prepare_run(self) -> None:
        pass

    def get_parameters(self, query_str: str, parameter: str) -> str:
        """Render the final SQL: interpolate the parameter literals and append the settings clause."""
        return query_str.format(**self.sql_params) + self.settings_clause

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
        # Local bindings: chDB's Python() table function resolves the table
        # names from the caller's scope.
        master = self.tables["master"]            # noqa: F841
        trade = self.tables["trade"]              # noqa: F841
        quote = self.tables["quote"]              # noqa: F841
        exnames = self.tables["exnames"]          # noqa: F841
        timeBuckets = self.tables["timeBuckets"]  # noqa: F841
        try:
            return chdb.query(sql, "ArrowTable")
        except Exception as e:
            logger.error("query execution failed: %s", e)
            raise

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

    def write_csv(self, res: pa.Table, out_file: Path) -> None:
        import pyarrow.csv as pa_csv
        columns = {}
        for f in res.schema:
            col = res[f.name]
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
