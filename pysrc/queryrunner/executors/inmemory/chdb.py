"""
chDB (embedded ClickHouse) in-memory query executor over ClickHouse Memory tables.

The tables (master, trade, quote, exnames, timeBuckets) are ClickHouse Memory
tables (CREATE TABLE ... ENGINE = Memory) that the queries name directly
(SELECT ... FROM trade), so both the storage and the scan are ClickHouse's own.
ClickHouse also reads the data: every load step is a CREATE TABLE ... AS SELECT,
the first one straight from the Parquet files through the file() table function,
with no Arrow table in between.

A Memory table cannot be altered in place, so each step (load, transform, sort)
builds the next table beside the current one and swaps it in -- see _rebuild --
which is also what keeps the steps separately measurable:

  * load      -- file() into Memory tables. Hive partitioning is switched off:
                 the date partition column is constant within the partition, and
                 the time-of-day columns stay date-less. trade and quote also
                 keep the parquet row's position (_file, _row_number) for the
                 sort below.
  * transform -- the types the queries expect, which are the ones the Arrow
                 executor gets for free from its duration[ns] and
                 dictionary-encoded columns: IntervalNanosecond for the
                 time-of-day columns (ClickHouse's Parquet reader sees them as
                 plain Int64 nanoseconds) and LowCardinality for the string
                 columns the Arrow executor holds encoded -- every one of them
                 but master's free-text description, which stays a plain String
                 here too. The sorted tables get their strings encoded by the
                 sort step instead, for the reason given there.
  * sort      -- trade and quote ordered by sortcols, ties broken by the parquet
                 row position so the numbering matches the Arrow executor's
                 stable sort -- by the file's position in the sorted file names
                 rather than by its name, see _file_position. Unlike there,
                 neither the rowid numbering nor the LowCardinality encoding can
                 be split off from the sort, so the cost of both is part of the
                 sort step:

                 The rows are numbered with rowNumberInAllBlocks() over a sorted
                 subquery rather than with a row_number() window function,
                 because a window function's rows do not reach the new Memory
                 table in the order it put them in: ClickHouse fans the window
                 transform's output back out over max_threads streams, and the
                 blocks are stored in whatever order those finish in. A plain
                 ORDER BY keeps its single stream all the way to the table.
                 Stored order is what the queries with no ORDER BY of their own
                 return, so it matters: on the tiny partition the window
                 formulation stored quote's 145 blocks in 95 runs of
                 consecutive rowids instead of one, leaving 5.0M of its 9.4M
                 rows away from the position their rowid gives them.

                 The strings are encoded in that same statement, and not by the
                 transform step above, because ClickHouse merges the sorted runs
                 a row at a time and every LowCardinality value crossing that
                 merge goes through the column's dictionary. On the tiny
                 partition, sorting quote already encoded takes ~57s and sorting
                 it as plain strings -- 2.7x the bytes -- 4s; encoding on the way
                 out adds ~0.2s, against ~0.5s as a second pass, which would
                 also have to be single-threaded to keep the order. Holding the
                 strings unencoded until the sort costs nothing in peak memory,
                 the window function's buffer for its whole-partition frame
                 having been larger than the unencoded columns are.

With CHDB_COMPRESS set, the two big tables are held as compressed Memory tables
(ENGINE = Memory SETTINGS compress = 1) instead: the same storage and the same
scan, with the blocks LZ4-compressed in memory, so the table takes less of it and
every scan pays the decompression. The small tables are unaffected, there being
nothing to gain on them.

Everything that is not about Memory tables being the storage lives in
chdb_base.py, next to the Arrow executor (chdb_pyarrow.py) that shares it.

Environment variables:
  CHDB_THREADS  (optional) Number of threads (ClickHouse max_threads) per query.
  CHDB_COMPRESS (optional) Boolean, false by default: hold trade and quote as
                compressed Memory tables.
"""
import logging
import os
from datetime import date
from pathlib import Path
from typing import Any

from executors.inmemory.chdb_base import QueryExecutorChDBBase

logger = logging.getLogger(__name__)

# What CHDB_COMPRESS is read as; anything else is a typo rather than a setting,
# and silently benchmarking the wrong thing is the one outcome to avoid.
_FALSE, _TRUE = ('', '0', 'false', 'no', 'off'), ('1', 'true', 'yes', 'on')


def _env_bool(name: str) -> bool:
    """Read a boolean environment variable; false when unset or empty."""
    value = os.environ.get(name, '').strip().lower()
    if value in _FALSE:
        return False
    if value in _TRUE:
        return True
    raise ValueError(f"{name} must be one of {_FALSE[1:] + _TRUE}, not {os.environ[name]!r}")


class QueryExecutorChDB(QueryExecutorChDBBase):
    """
    Handles the setup, execution of chDB queries over ClickHouse Memory tables.
    """

    # The time-of-day columns each table stores as int64 nanoseconds. Parquet
    # keeps their duration[ns] type in the Arrow schema only, which ClickHouse
    # does not read, so they are named here -- see the time_cols arguments of
    # pysrc/taqToParquet/table_converters.py.
    DURATION_COLUMNS: dict[str, tuple[str, ...]] = {
        "master": (),
        "trade": ("time", "participantTimestamp", "tradeReportingFacilityTRFTimestamp"),
        "quote": ("time", "participantTimestamp", "FINRAADFTimestamp"),
    }
    # The parquet row position, kept on the tables that are sorted: the file the
    # row was read from, and its row number within that file.
    SRC_FILE: str = "_src_file"
    SRC_ROW: str = "_src_row"
    ROW_POSITION: tuple[str, ...] = (SRC_FILE, SRC_ROW)
    # The tables CHDB_COMPRESS applies to: the two the data is in.
    COMPRESSED_TABLES: tuple[str, ...] = ("trade", "quote")
    # The string columns left unencoded, being unencoded in the other engines
    # too: master's free-text description, which the Parquet schema keeps a
    # plain string where every other string column of the table is
    # dictionary-encoded -- see pysrc/taqToParquet/schemas.py.
    PLAIN_STRING_COLUMNS: dict[str, tuple[str, ...]] = {"master": ("description",)}

    def __init__(self, param: dict[str, Any], sort_cols: list[str], datadate: date) -> None:
        # Read before the base __init__, which creates the first Memory table.
        self.compress: bool = _env_bool('CHDB_COMPRESS')
        super().__init__(param, sort_cols, datadate)
        logger.info("holding %s as compressed Memory tables: %s",
                    ", ".join(self.COMPRESSED_TABLES), self.compress)

    def _table_ref(self, name: str) -> str:
        """How the queries reach the table: by its Memory table name."""
        return name

    def _add_timebuckets(self, rows: list[tuple[str, int]]) -> None:
        self._query("CREATE TABLE timeBuckets (bucket Nullable(String),"
                    " bound Nullable(IntervalNanosecond), rowid Nullable(UInt64))"
                    " ENGINE = Memory", "CSV")
        values = ", ".join(
            f"({self._sql_literal(bucket)}, toIntervalNanosecond({bound}), {rowid})"
            for rowid, (bucket, bound) in enumerate(rows))
        self._query(f"INSERT INTO timeBuckets VALUES {values}", "CSV")

    def _load(self, db_path: Path, datadate: date) -> None:
        partition = {name: db_path / name / f"date={datadate}" / "*.parquet"
                     for name in self.REPORTED_TABLES}
        for name, src in {"exnames": db_path / "exnames.parquet", **partition}.items():
            logger.info("loading %s", name)
            columns = "*"
            if name in self.SORTED_TABLES:
                columns += ", _file AS _src_file, _row_number AS _src_row"
            self._create(name, f"SELECT {columns} FROM file({self._sql_literal(str(src))}, Parquet)",
                         " SETTINGS use_hive_partitioning = 0")

    def _low_cardinality(self, name: str) -> list[str]:
        """The REPLACE terms that encode the table's string columns, bar the
        PLAIN_STRING_COLUMNS the other engines keep unencoded as well."""
        plain = self.PLAIN_STRING_COLUMNS.get(name, ())
        return [f"CAST({c} AS LowCardinality(Nullable(String))) AS {c}"
                for c in self._columns(name, of_type="Nullable(String)") if c not in plain]

    def _transform_tables(self) -> None:
        logger.info("applying transformations")
        for name in self.REPORTED_TABLES:
            replace = [f"toIntervalNanosecond({c}) AS {c}" for c in self.DURATION_COLUMNS[name]]
            # The sorted tables are encoded by the sort step instead; see there.
            if name not in self.SORTED_TABLES:
                replace += self._low_cardinality(name)
            self._rebuild(name, f"SELECT * REPLACE ({', '.join(replace)}) FROM {name}")
            logger.info("Shape of %s: %s x %s", name, *self._shape(name))

    def _file_position(self, name: str) -> str:
        """The ORDER BY term that orders the rows by the file they came from.

        The file's position in the table's file names, sorted, rather than the
        name itself: the tie-break is reached by every pair of rows with equal
        sort_cols values, and comparing _src_file there means walking a
        LowCardinality(String) whose values share their prefix and differ only
        near the end (part-0.parquet, part-1.parquet, ...) instead of comparing
        an integer. A table of this shape built to measure it -- 20M rows over
        20 files, 50 rows per distinct sort key, unordered -- sorts in ~11s by
        the name and ~3s by the position, against ~2.3s with no tie-break at
        all, so nearly all of the tie-break's cost is the string.

        The file names come from the column itself, so the order is the one
        ORDER BY _src_file gave and the numbering the sort produces does not
        change. ClickHouse answers the DISTINCT from the column's
        LowCardinality dictionaries, without a scan of the rows.
        """
        files = self._query(f"SELECT DISTINCT {self.SRC_FILE} FROM {name}"
                            f" ORDER BY {self.SRC_FILE}", "ArrowTable")[self.SRC_FILE].to_pylist()
        array = "[" + ", ".join(self._sql_literal(f) for f in files) + "]"
        return f"indexOf({array}, {self.SRC_FILE})"

    def _sort_tables(self) -> None:
        for name in self.SORTED_TABLES:
            order_by = ", ".join(list(self.sort_cols)
                                 + [self._file_position(name), self.SRC_ROW])
            logger.info("ordering %s by %s", name,
                        ", ".join(list(self.sort_cols) + list(self.ROW_POSITION)))
            self._rebuild(name, f"SELECT * EXCEPT ({', '.join(self.ROW_POSITION)})"
                                f" REPLACE ({', '.join(self._low_cardinality(name))}),"
                                " rowNumberInAllBlocks() AS rowid"
                                f" FROM (SELECT * FROM {name} ORDER BY {order_by})")

    def _engine(self, table: str) -> str:
        """The engine clause the table is built with: Memory, compressed for the
        big ones when CHDB_COMPRESS is set."""
        if self.compress and table in self.COMPRESSED_TABLES:
            return "Memory SETTINGS compress = 1"
        return "Memory"

    def _create(self, name: str, select: str, settings: str = "", table: str | None = None) -> None:
        """Build the Memory table `name` from `select`.

        `table` names the table whose engine clause applies, for when `name` is
        only a stand-in for it -- the {name}_next of a rebuild.
        """
        self._query(f"CREATE TABLE {name} ENGINE = {self._engine(table or name)}"
                    f" AS {select}{settings}", "CSV")

    def _rebuild(self, name: str, select: str) -> None:
        """Replace the Memory table `name` with the result of `select` over it.

        The new table is built next to the current one and swapped in, so the
        previous copy is only freed -- by the DROP -- once the step succeeded.
        """
        self._create(f"{name}_next", select, table=name)
        self._query(f"DROP TABLE {name}", "CSV")
        self._query(f"RENAME TABLE {name}_next TO {name}", "CSV")

    def _columns(self, name: str, of_type: str | None = None) -> list[str]:
        """The table's column names in order, optionally only those of one type."""
        res = self._query(
            "SELECT name FROM system.columns WHERE database = currentDatabase()"
            f" AND table = {self._sql_literal(name)}"
            + (f" AND type = {self._sql_literal(of_type)}" if of_type else "")
            + " ORDER BY position", "ArrowTable")
        return res["name"].to_pylist()

    def _table_info(self, name: str) -> tuple[int, int]:
        """The table's row count and size in bytes."""
        res = self._query(
            "SELECT total_rows, total_bytes FROM system.tables"
            f" WHERE database = currentDatabase() AND name = {self._sql_literal(name)}", "ArrowTable")
        return res["total_rows"][0].as_py(), res["total_bytes"][0].as_py()

    def _shape(self, name: str) -> tuple[int, int]:
        return self._table_info(name)[0], len(self._columns(name))

    def _tables_size_kb(self) -> int:
        return sum(self._table_info(t)[1] for t in self.REPORTED_TABLES) // 1024

    def _table_stats(self, name: str) -> dict[str, Any]:
        rows, size = self._table_info(name)
        desc = self._query(f"DESCRIBE TABLE {name}", "ArrowTable")
        return {
            "name": name,
            "size (MB)": size / 1024 / 1024,
            "rowCount": rows,
            "columnCount": desc.num_rows,
            "columns": [
                {"name": n, "type": t}
                for n, t in zip(desc["name"].to_pylist(), desc["type"].to_pylist())
            ],
        }
