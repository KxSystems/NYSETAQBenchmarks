"""
Shared machinery of the two Polars in-memory executors.

Both load a single partition into memory and run the same kind of Polars
expression from their query file, evaluated with eval() against a context
holding the tables and the query parameters. They differ only in which Polars
API that expression is written against, which decides how every step of the
setup and every query result is produced:

  * polars_eager.py          -- DataFrames throughout, the eager API; a query
                                returns a DataFrame.
  * polars_lazy_streaming.py -- LazyFrames in the eval context, collected with
                                the streaming engine; the setup steps are lazy
                                too, except the sort, which the streaming engine
                                has no advantage in.

The tables are kept as DataFrames in self._tables regardless -- that is what the
size and schema reported to the driver are read from -- and handed to the queries
through _frame(), in whichever form that executor's queries expect.
"""
import logging
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import polars as pl

logger = logging.getLogger(__name__)


class QueryExecutorPolarsBase:
    """
    Handles the setup and execution shared by the Polars executors. Which Polars
    API the work runs through is left to the subclasses' _scan, _transform,
    _sort, _frame and _collect implementations.
    """

    # The tables loaded into memory and reported to the driver.
    TABLES: tuple[str, ...] = ("master", "trade", "quote")
    # The tables that are sorted by sort_cols.
    SORTED_TABLES: tuple[str, ...] = ("trade", "quote")

    def __init__(self, param: dict[str, Any], sort_cols: str | list[str], datadate: date) -> None:
        self.params: dict[str, Any] = param
        self.sort_cols: str | list[str] = sort_cols
        self._tables: dict[str, pl.DataFrame] = {}
        time_buckets = pl.DataFrame(
            list(self.params['timeBuckets'].items()), schema=['bucket', 'bound'])
        self.params['timeBuckets'] = time_buckets.with_columns(pl.col('bound').cast(pl.Duration('ns')))
        self.eval_context: dict[str, Any] = {
            "pl": pl,
            "timedelta": timedelta,
            "datadate": datadate,
            **self.params,
        }
        self.eval_context["timeBuckets"] = self._frame(self.params['timeBuckets'])

    def _scan(self, source: Path) -> pl.DataFrame:
        """Read the Parquet file(s) at `source` into memory."""
        raise NotImplementedError

    def _transform(self, df: pl.DataFrame) -> pl.DataFrame:
        """Bring a loaded table to the types the queries expect."""
        raise NotImplementedError

    def _sort(self, df: pl.DataFrame) -> pl.DataFrame:
        """Order a table by sort_cols."""
        raise NotImplementedError

    def _frame(self, df: pl.DataFrame):
        """How a table is handed to the queries: as it is, or lazily."""
        raise NotImplementedError

    def _collect(self, res):
        """Bring a query's result into the form the driver reads it in."""
        return res

    @staticmethod
    def _timed(ios, step) -> tuple[int, int]:
        """Run a load step and return its elapsed time in ns and its IO in KB."""
        io_start = ios.get_io_stat()
        t_start = time.perf_counter_ns()
        step()
        t_end = time.perf_counter_ns()
        return t_end - t_start, ios.get_io_stat() - io_start

    def _tables_size_kb(self) -> int:
        """Total size of the loaded tables, as written into the setup rows."""
        return sum(self.get_table_size(df) for df in self._tables.values())

    def load_resources(self, db_path: Path, datadate: date, writer, row_start, ios) -> None:
        logger.info("loading hive-partitioned tables at %s", db_path)
        exnames: dict[Any, Any] = {}

        def load() -> None:
            nonlocal exnames
            table = self._scan(db_path / "exnames.parquet")
            exnames = dict(zip(table["ex"], table["name"]))
            for name in self.TABLES:
                logger.info("loading %s", name)
                self._tables[name] = self._scan(db_path / name / f"date={datadate}" / "*.parquet")

        def transform() -> None:
            for name in self.TABLES:
                df = self._transform(self._tables[name])
                logger.info("Shape of %s: %s x %s", name, df.shape[0], df.shape[1])
                self._tables[name] = df

        def sort() -> None:
            for name in self.SORTED_TABLES:
                self._tables[name] = self._sort(self._tables[name])

        t_load, io_load = self._timed(ios, load)
        writer.writerow(row_start + [0, "load a partition into memory", "success", t_load, None, None,
                         None, io_load, None, None, self._tables_size_kb()])

        t_transform, io_transform = self._timed(ios, transform)
        writer.writerow(row_start + [-1, "transform", "success", t_transform, None, None,
                         None, io_transform, None, None, self._tables_size_kb()])

        t_sort, io_sort = self._timed(ios, sort)
        writer.writerow(row_start + [-2, "sort", "success", t_sort, None, None,
                         None, io_sort, None, None, self._tables_size_kb()])

        self.eval_context["exnames"] = exnames
        for name, df in self._tables.items():
            self.eval_context[name] = self._frame(df)

    @staticmethod
    def get_table_size(df) -> int:
        return int(df.estimated_size("kb"))

    def get_table_stats(self) -> dict[str, Any]:
        table_stats_dict = {"proprietary": "no", "engineversion": pl.__version__}
        for t_name in self.TABLES:
            df = self._tables[t_name]
            table_stats = {
                "name": t_name,
                "size (MB)": self.get_table_size(df) / 1024,
                "rowCount": df.shape[0],
                "columnCount": df.shape[1],
                "columns": [
                    {"name": col, "type": str(df.schema[col])}
                    for col in df.columns
                ],
            }
            table_stats_dict[t_name] = table_stats
        return table_stats_dict

    def prepare_run(self) -> None:
        pass

    def get_parameters(self, query_str: str, parameter: str) -> str:
        return parameter

    def execute_query(self, idx: int, tags: set, query_str: str, parameter: str, runidx: int):
        return self._collect(eval(query_str, self.eval_context))

    @staticmethod
    def _fmt_minute(col: str) -> pl.Expr:
        ns = pl.col(col).dt.total_nanoseconds()
        hh = ((ns // 3_600_000_000_000) % 24).cast(pl.String).str.zfill(2)
        mm = ((ns // 60_000_000_000) % 60).cast(pl.String).str.zfill(2)
        return pl.concat_str([hh, pl.lit(":"), mm]).alias(col)

    @staticmethod
    def _fmt_duration(col: str) -> pl.Expr:
        ns = pl.col(col).dt.total_nanoseconds()
        days = (ns // 86_400_000_000_000).cast(pl.String)
        hh = ((ns // 3_600_000_000_000) % 24).cast(pl.String).str.zfill(2)
        mm = ((ns // 60_000_000_000) % 60).cast(pl.String).str.zfill(2)
        ss = ((ns // 1_000_000_000) % 60).cast(pl.String).str.zfill(2)
        subsec = (ns % 1_000_000_000).cast(pl.String).str.zfill(9)
        return pl.concat_str([
            days, pl.lit("D"),
            hh, pl.lit(":"),
            mm, pl.lit(":"),
            ss, pl.lit("."),
            subsec,
        ]).alias(col)

    def write_csv(self, res, out_file: Path) -> None:
        duration_cols = [
            c for c in res.columns
            if res.schema[c] == pl.Duration and c != "minute"
        ]
        has_minute = "minute" in res.columns and res.schema["minute"] == pl.Duration

        exprs = [pl.col(pl.Boolean).cast(pl.Int8).cast(pl.String)]
        if has_minute:
            exprs.append(self._fmt_minute("minute"))
        exprs.extend(self._fmt_duration(c) for c in duration_cols)

        res = res.with_columns(exprs)
        res.write_csv(out_file)
