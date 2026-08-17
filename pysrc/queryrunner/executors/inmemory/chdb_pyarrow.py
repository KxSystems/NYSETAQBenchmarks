"""
chDB (embedded ClickHouse) in-memory query executor over Apache Arrow tables.

The tables (master, trade, quote, exnames, timeBuckets) are stored in memory as
Apache Arrow tables. The queries reference them through chDB's Python() table
function (e.g. SELECT ... FROM Python(trade)), which scans the Arrow data
directly, so Arrow remains the storage format: chDB reads its input from
pyarrow's duration[ns] and dictionary-encoded columns as IntervalNanosecond and
LowCardinality without a conversion of its own.

A query's result is Arrow too: it is returned in chDB's ArrowTable format, so the
whole executor stays in one memory layout, the input the queries scan and the
result they produce alike -- the counterpart of the Polars and Pandas executors
returning a frame of their own, rather than of the ClickHouse Memory table
executor materialising its result in ClickHouse's memory.

Everything that is not about Arrow being the storage -- the session, the settings,
the SQL rendering, the setup rows, the CSV writing -- lives in chdb_base.py, next
to the ClickHouse Memory table executor (chdb.py) that shares it.

Environment variables:
  CHDB_THREADS (optional) Number of threads: ClickHouse max_threads for the
               queries, and Arrow's CPU and IO thread pools for the loading.
"""
import logging
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pyarrow as pa
import pyarrow.dataset as pa_ds

from executors.inmemory.chdb_base import QueryExecutorChDBBase

logger = logging.getLogger(__name__)


class QueryExecutorChDBPyArrow(QueryExecutorChDBBase):
    """
    Handles the setup, execution of chDB queries over in-memory Arrow tables.
    """

    def __init__(self, param: dict[str, Any], sort_cols: list[str], datadate: date) -> None:
        # The tables the queries scan; _add_timebuckets, called by the base
        # __init__, adds the first one.
        self.tables: dict[str, pa.Table] = {}
        super().__init__(param, sort_cols, datadate)
        # Arrow reads and sorts the tables with its own thread pools, which
        # chDB's max_threads does not reach, so cap them at the same count the
        # queries run with -- otherwise the load steps would ignore the
        # requested thread count and use every core.
        pa.set_cpu_count(self.threads)
        pa.set_io_thread_count(self.threads)

    def _table_ref(self, name: str) -> str:
        """How the queries reach the table: through the Python() table function."""
        return f"Python({name})"

    def _add_timebuckets(self, rows: list[tuple[str, int]]) -> None:
        self.tables["timeBuckets"] = pa.table({
            "bucket": pa.array([bucket for bucket, _ in rows]),
            "bound": pa.array([bound for _, bound in rows], pa.duration('ns')),
            "rowid": pa.array(range(len(rows)), pa.uint64()),
        })

    def _load(self, db_path: Path, datadate: date) -> None:
        self.tables["exnames"] = pa_ds.dataset(db_path / "exnames.parquet", format="parquet").to_table()
        # The date partition column is constant within the partition and the
        # time-of-day columns stay date-less durations, so it is not read.
        self.tables["master"] = pa_ds.dataset(db_path / "master" / f"date={datadate}", format="parquet").to_table()
        logger.info("loading trade")
        self.tables["trade"] = pa_ds.dataset(db_path / "trade" / f"date={datadate}", format="parquet").to_table()
        logger.info("loading quote")
        self.tables["quote"] = pa_ds.dataset(db_path / "quote" / f"date={datadate}", format="parquet").to_table()

    def _transform_tables(self) -> None:
        """Dictionary-encode the sym column; chDB surfaces it as LowCardinality."""
        logger.info("applying transformations")
        for name in self.REPORTED_TABLES:
            tbl = self.tables[name]
            if 'sym' in tbl.column_names and not pa.types.is_dictionary(tbl['sym'].type):
                idx = tbl.column_names.index('sym')
                self.tables[name] = tbl.set_column(idx, 'sym', tbl['sym'].dictionary_encode())
            logger.info("Shape of %s: %s x %s", name, *self.tables[name].shape)

    def _sort_tables(self) -> None:
        for name in self.SORTED_TABLES:
            logger.info("ordering %s by %s", name, ", ".join(self.sort_cols))
            self.tables[name] = self.tables[name].sort_by([(c, 'ascending') for c in self.sort_cols])

    def _post_sort(self) -> None:
        """Number the rows by their sorted position. sort_by is stable, so this
        matches DuckDB's implicit rowid after its ORDER BY ..., rowid rebuild."""
        for name in self.SORTED_TABLES:
            tbl = self.tables[name]
            self.tables[name] = tbl.append_column(
                'rowid', pa.array(np.arange(tbl.num_rows, dtype=np.uint64)))

    def _tables_size_kb(self) -> int:
        return sum(self.get_table_size(self.tables[t]) for t in self.REPORTED_TABLES)

    @classmethod
    def _type_str(cls, t: pa.DataType) -> str:
        """Arrow prints float32 as 'float' and float64 as 'double'; persist unambiguous names."""
        if pa.types.is_dictionary(t):
            return f"dictionary<{cls._type_str(t.value_type)}>"
        if pa.types.is_floating(t):
            return f"float{t.bit_width}"
        return str(t)

    def _table_stats(self, name: str) -> dict[str, Any]:
        df = self.tables[name]
        fields = list(df.schema)
        return {
            "name": name,
            "size (MB)": self.get_table_size(df) / 1024,
            "rowCount": df.shape[0],
            "columnCount": len(fields),
            "columns": [
                {"name": f.name, "type": self._type_str(f.type)}
                for f in fields
            ],
        }

    def _query(self, sql: str, fmt: str):
        # Local bindings: chDB's Python() table function resolves the table names
        # from the calling frames' scope, and every query the session runs comes
        # through here -- the queries themselves, and the ones the executor runs
        # around them, be it to describe a table or to re-read a result. The
        # tables are bound as they are, missing ones included, since a query that
        # names a table it does not have would be a bug either way.
        master = self.tables.get("master")            # noqa: F841
        trade = self.tables.get("trade")              # noqa: F841
        quote = self.tables.get("quote")              # noqa: F841
        exnames = self.tables.get("exnames")          # noqa: F841
        timeBuckets = self.tables.get("timeBuckets")  # noqa: F841
        return super()._query(sql, fmt)

    def prepare_run(self) -> None:
        """Nothing to drop: a result is an Arrow table the driver releases itself."""

    def execute_query(self, idx: int, tags: set, query_str: str, sql: str, runidx: int) -> pa.Table:
        """Run the query and return its result as an Arrow table.

        The measured section holds the query and its result in Arrow, the layout
        the tables it scanned are in as well -- so no conversion into a third
        party's memory is paid for, and the driver reads the shape and the size
        of the result, and its rows for the query output, straight off it.
        """
        try:
            return self._query(sql, "ArrowTable")
        except Exception as e:
            logger.error("query execution failed: %s", e)
            raise

    def write_csv(self, res: pa.Table, out_file: Path) -> None:
        self._write_arrow_csv(res, out_file)
