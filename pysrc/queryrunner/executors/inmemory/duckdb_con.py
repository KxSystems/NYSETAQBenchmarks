"""
DuckDB in-memory query executor.

Environment variables:
  SYMENUMBYTABLE (optional) Controls how the `sym` column is encoded as an
                 ENUM type. Defaults to "false".
                 - false (default): a single shared ENUM (`sym_enum`), built
                   from the union of symbols across master, trade and quote, is
                   applied to all three tables.
                 - true: each table gets its own ENUM built from only that
                   table's distinct symbols (`sym_master_enum`,
                   `sym_trade_enum`, `sym_quote_enum`).
                 Accepted truthy values (case-insensitive): true, 1, yes.
"""
import logging
import os
import time
from datetime import date
from pathlib import Path
from typing import Any

import duckdb

logger = logging.getLogger(__name__)


class QueryExecutorDuckDBCon:
    """
    Handles the setup, execution of DuckDB in-memory queries.
    """

    def __init__(self, con, param: dict[str, Any], sort_cols: list[str], index_on: str | list[str] = []) -> None:
        self.con: duckdb.DuckDBPyConnection = con
        self.params: dict[str, Any] = param
        timebuckets_rows = list(self.params.pop('timeBuckets').items())
        self.con.execute("CREATE TABLE timeBuckets (bucket VARCHAR, bound TIME)")
        self.con.executemany("INSERT INTO timeBuckets VALUES (?, ?)", [(bucket, str(delta)) for bucket, delta in timebuckets_rows])
        self.index_on: str | list[str] = index_on
        self.sort_cols: str | list[str] = sort_cols

    def load_resources(self, db_path: Path, datadate: date, writer, row_start, ios) -> None:
        logger.info("loading hive-partitioned tables at %s", db_path)

        io_load_start = ios.get_io_stat()
        t_load_start = time.perf_counter_ns()
        self.con.execute("SET preserve_insertion_order = true") # this is the default, but make it explicite
        self.con.execute("CREATE TABLE exnames AS SELECT * FROM read_parquet($1)", parameters=[str(db_path / "exnames.parquet")])

        self.con.execute("CREATE TABLE master AS SELECT * EXCLUDE (date) FROM read_parquet($1, hive_partitioning=True)",
            parameters=[str(db_path / "master" / f"date={datadate}" / "*.parquet")])

        logger.info("loading trade")
        self.con.execute("CREATE TABLE trade AS SELECT * FROM read_parquet($1, hive_partitioning=True)",
            parameters=[str(db_path / "trade" / f"date={datadate}" / "*.parquet")])

        logger.info("loading quote")
        self.con.execute("CREATE TABLE quote AS SELECT * FROM read_parquet($1, hive_partitioning=True)",
            parameters=[str(db_path / "quote" / f"date={datadate}" / "*.parquet")])
        t_load_elapsed = time.perf_counter_ns() - t_load_start
        io_load_end = ios.get_io_stat()
        writer.writerow(row_start + [0, "load a partition into memory", "success", t_load_elapsed, None, None,
                         None, io_load_end - io_load_start, None, None, sum(filter(None, [self.get_table_size("master"), self.get_table_size("trade"), self.get_table_size("quote")])) or None])


        io_load_start = ios.get_io_stat()
        t_load_start = time.perf_counter_ns()
        logger.info("applying transformations")
        sym_enum_by_table = os.getenv('SYMENUMBYTABLE', 'false').lower() in ('true', '1', 'yes')
        if sym_enum_by_table:
            self.con.execute("CREATE TYPE sym_master_enum AS ENUM (SELECT DISTINCT sym FROM master)")
            self.con.execute("CREATE TYPE sym_trade_enum AS ENUM (SELECT DISTINCT sym FROM trade)")
            self.con.execute("CREATE TYPE sym_quote_enum AS ENUM (SELECT DISTINCT sym FROM quote)")
            master_enum, trade_enum, quote_enum = "sym_master_enum", "sym_trade_enum", "sym_quote_enum"
        else:
            self.con.execute("CREATE TYPE sym_enum AS ENUM (SELECT DISTINCT sym FROM master UNION SELECT DISTINCT sym FROM trade UNION SELECT DISTINCT sym FROM quote)")
            master_enum = trade_enum = quote_enum = "sym_enum"
        self.con.execute(f"ALTER TABLE master ALTER sym TYPE {master_enum}")
        master=self.con.table("master")
        logger.info("Shape of master: %s x %s", master.shape[0], master.shape[1])

        logger.info("applying transformations")
        self.con.execute("CREATE OR REPLACE TABLE trade AS SELECT make_timestamp_ns(epoch_ns(date)+time) AS time, " +
            "make_timestamp_ns(epoch_ns(date)+participantTimestamp) AS participantTimestamp, " +
            "make_timestamp_ns(epoch_ns(date)+tradeReportingFacilityTRFTimestamp) AS tradeReportingFacilityTRFTimestamp, " +
            "* EXCLUDE (date, time, participantTimestamp, tradeReportingFacilityTRFTimestamp) FROM trade")
        self.con.execute(f"ALTER TABLE trade ALTER sym TYPE {trade_enum}")
        trade=self.con.table("trade")
        logger.info("Shape of trade: %s x %s", trade.shape[0], trade.shape[1])


        logger.info("applying transformations")
        self.con.execute("CREATE OR REPLACE TABLE quote AS SELECT make_timestamp_ns(epoch_ns(date)+time) AS time, " +
            "make_timestamp_ns(epoch_ns(date)+participantTimestamp) AS participantTimestamp, " +
            "make_timestamp_ns(epoch_ns(date)+FINRAADFTimestamp) AS FINRAADFTimestamp, " +
            "* EXCLUDE (date, time, participantTimestamp, FINRAADFTimestamp) FROM quote")
        logger.info("applying transformations")
        self.con.execute(f"ALTER TABLE quote ALTER sym TYPE {quote_enum}")
        quote=self.con.table("quote")
        logger.info("Shape of quote: %s x %s", quote.shape[0], quote.shape[1])
        t_load_elapsed = time.perf_counter_ns() - t_load_start
        io_load_end = ios.get_io_stat()
        writer.writerow(row_start + [-1, "transform", "success", t_load_elapsed, None, None,
                         None, io_load_end - io_load_start, None, None, sum(filter(None, [self.get_table_size(master), self.get_table_size(trade), self.get_table_size(quote)])) or None])


        io_load_start = ios.get_io_stat()
        t_load_start = time.perf_counter_ns()
        order_by = ", ".join(self.sort_cols)
        logger.info("ordering trade by %s", order_by)
        self.con.execute(f"CREATE OR REPLACE TABLE trade AS SELECT * FROM trade ORDER BY {order_by}, rowid")
        logger.info("ordering quote by %s", order_by)
        self.con.execute(f"CREATE OR REPLACE TABLE quote AS SELECT * FROM quote ORDER BY {order_by}, rowid")

        t_load_elapsed = time.perf_counter_ns() - t_load_start
        io_load_end = ios.get_io_stat()
        writer.writerow(row_start + [-2, "sort", "success", t_load_elapsed, None, None,
                         None, io_load_end - io_load_start, None, None, sum(filter(None, [self.get_table_size(master), self.get_table_size(trade), self.get_table_size(quote)])) or None])

        if len(self.index_on) > 0:
            io_load_start = ios.get_io_stat()
            t_load_start = time.perf_counter_ns()
            for c in self.index_on:
                logger.info("adding index on %s in trade", c)
                self.con.execute(f"CREATE INDEX IF NOT EXISTS idx_trade_{c} ON trade ({c})")
                logger.info("adding index on %s in quote", c)
                self.con.execute(f"CREATE INDEX IF NOT EXISTS idx_quote_{c} ON quote ({c})")

            t_load_elapsed = time.perf_counter_ns() - t_load_start
            io_load_end = ios.get_io_stat()
            writer.writerow(row_start + [-3, "index", "success", t_load_elapsed, None, None,
                             None, io_load_end - io_load_start, None, None, sum(filter(None, [self.get_table_size(master), self.get_table_size(trade), self.get_table_size(quote)])) or None])

    @staticmethod
    def get_table_size(df) -> None:
        return None

    def get_table_stats(self) -> dict[str, Any]:
        table_stats_dict = {"proprietary": "no", "engineversion": duckdb.__version__}
        for t_name in ["master", "trade", "quote"]:
            df = self.con.table(t_name)
            table_stats = {
                "name": t_name,
                "size (MB)": (s / 1024 if (s := self.get_table_size(df)) is not None else None),
                "rowCount": df.shape[0],
                "columnCount": df.shape[1],
                "columns": [
                    {"name": col, "type": "ENUM" if str(dtype).startswith("ENUM") else str(dtype)}
                    for col, dtype in zip(df.columns, df.dtypes)
                    ],
            }
            table_stats_dict[t_name] = table_stats
        return table_stats_dict

    def prepare_run(self) -> None:
        self.con.execute("DROP TABLE IF EXISTS res")

    def get_parameters(self, parameter: str) -> list[Any]:
        return [eval(p.strip(), self.params) for p in parameter.split(",")] if parameter else []

    def execute_query(self, idx: int, tags: set, query_str: str, params: list[Any], runidx: int):
        try:
            self.con.execute(f"CREATE TABLE res AS {query_str}", parameters=params)
        except Exception as e:
            logger.error("query execution failed: %s", e)
            self.con.rollback()
            raise
        return self.con.table('res')


    def write_csv(self, res, out_file: Path) -> None:
        tscols = [row[0] for row in self.con.sql("SELECT column_name FROM (DESCRIBE res) WHERE column_type = 'TIMESTAMP_NS'").fetchall()]
        for col in tscols:
            self.con.sql(f"CREATE OR REPLACE TABLE res AS SELECT * REPLACE (format('0D{{:02d}}:{{:02d}}:{{:02d}}.{{:09d}}', hour({col}), minute({col}), second({col}), (epoch_ns({col}) % 1000000000)) AS {col}) FROM res")

        bcols = [row[0] for row in self.con.sql("SELECT column_name FROM (DESCRIBE res) WHERE column_type = 'BOOLEAN'").fetchall()]
        for col in bcols:
            self.con.sql(f"CREATE OR REPLACE TABLE res AS SELECT * REPLACE ({col}::INTEGER AS {col}) FROM res")
        self.con.table('res').write_csv(str(out_file))
