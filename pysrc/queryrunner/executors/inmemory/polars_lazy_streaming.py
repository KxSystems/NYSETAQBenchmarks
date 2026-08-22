"""
Polars in-memory executor running the lazy API with the streaming engine (single
partition loaded into memory): the queries see LazyFrames and their results are
collected with the streaming engine, as are the load and transform steps. The
sort stays on the in-memory engine, which is faster for it. The shared machinery
is in polars_base.py.
"""
from pathlib import Path

import polars as pl

from executors.inmemory.polars_base import QueryExecutorPolarsBase


class QueryExecutorPolarsLazy(QueryExecutorPolarsBase):
    """
    Handles the setup, execution of Polars in-memory queries
    (single partition loaded into memory).
    """

    def _scan(self, source: Path) -> pl.DataFrame:
        return pl.scan_parquet(source).collect(engine="streaming")

    def _transform(self, df: pl.DataFrame) -> pl.DataFrame:
        return df.lazy().with_columns(pl.col("sym").cast(pl.Categorical)).collect(engine="streaming")

    def _sort(self, df: pl.DataFrame) -> pl.DataFrame:
        return df.lazy().sort(self.sort_cols).collect(engine="in-memory")

    def _frame(self, df: pl.DataFrame) -> pl.LazyFrame:
        return df.lazy()

    def _collect(self, res):
        if isinstance(res, pl.LazyFrame):
            return res.collect(engine="streaming")
        return res
