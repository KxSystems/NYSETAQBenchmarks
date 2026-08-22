"""
Polars in-memory executor running the eager API (single partition loaded into
memory): the tables are DataFrames, every setup step runs eagerly, and a query
returns a DataFrame. The shared machinery is in polars_base.py.
"""
from pathlib import Path

import polars as pl

from executors.inmemory.polars_base import QueryExecutorPolarsBase


class QueryExecutorPolarsEager(QueryExecutorPolarsBase):
    """
    Handles the setup, execution of Polars in-memory queries
    (single partition loaded into memory).
    """

    def _scan(self, source: Path) -> pl.DataFrame:
        return pl.scan_parquet(source).collect()

    def _transform(self, df: pl.DataFrame) -> pl.DataFrame:
        return df.with_columns(pl.col("sym").cast(pl.Categorical))

    def _sort(self, df: pl.DataFrame) -> pl.DataFrame:
        return df.sort(self.sort_cols)

    def _frame(self, df: pl.DataFrame) -> pl.DataFrame:
        return df
