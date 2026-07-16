#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "duckdb>=1.4",
#   "numexpr",
#   "numpy>=1.26",
#   "pandas>=2.3",
#   "polars>=1.35",
#   "psutil>=7.1",
#   "pykx>=4.0.0",
#   "pyarrow>=13.0.0",
#   "pyyaml",
# ]
# ///

"""
Script to run queries on NYSE TAQ and collect performance metrics (like execution time)

Environment variables:
  FLUSH               (required) Path to the cache-flush binary; called before each cold run
  DUCKDB_THREADS      (optional) Number of threads for DuckDB engines
  NUMEXPR_NUM_THREADS (optional) Number of threads for the Pandas/numexpr engine
"""
import argparse
import contextlib
import csv
import gc
import io
import logging
import os
import subprocess
import sys
import time as time_mod  # alias to avoid naming conflict
from dataclasses import dataclass
from datetime import datetime, time, timedelta  # time is used in queries
from pathlib import Path
from typing import Any

import yaml

from iostat import IOStat

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger: logging.Logger = logging.getLogger(__name__)

def parse_idx_filter(s: str) -> set[int]:
    """Parse idx filter: single number (42), comma-separated list (32,42,50), or range (40-44)."""
    result: set[int] = set()
    for part in s.split(','):
        part = part.strip()
        if '-' in part:
            start, end = part.split('-', 1)
            result.update(range(int(start), int(end) + 1))
        else:
            result.add(int(part))
    return result

def parse_sortcols(s: str) -> list[str]:
    """Parse comma-separated sort columns, e.g. 'time' or 'sym,time'."""
    return [c.strip() for c in s.split(',') if c.strip()]

def load_parameters(param_dir: Path) -> dict[str, Any]:
    """Reads parameter text files into the params dictionary."""
    params: dict[str, Any] = {}
    def read_single(filename: str) -> str:
        return (param_dir / filename).read_text(encoding='utf-8').strip()
    def read_list(filename: str) -> list[str]:
        content = (param_dir / filename).read_text(encoding='utf-8')
        return [line.strip() for line in content.splitlines() if line.strip()]
    params.update({
        "freqInstr": read_single("freqInstr.txt"),
        "infreqInstr": read_single("infreqInstr.txt"),

        "fiftyInstrs": read_list("fiftyInstrs.txt"),
        "thousandInfreqInstrs": read_list("thousandInfreqInstrs.txt")
    })

    def _to_timedelta(s: str) -> timedelta:
        t = datetime.strptime(s[2:], "%H:%M:%S.%f")
        return timedelta(hours=t.hour, minutes=t.minute, seconds=t.second, microseconds=t.microsecond)

    with open(param_dir / "timeBuckets.txt", "r", encoding="utf-8") as f:
        params["timeBuckets"] = {line.split("=")[0].strip():
                                 _to_timedelta(line.split("=")[1].strip())
                                 for line in f}

    return params

@dataclass
class QueryResult:
    """Data class to hold the results of a query benchmark."""
    query: str
    status: str
    run1_time_ns: int | None = None
    run2_time_ns: int | None = None
    run3_time_ns: int | None = None
    run1_io_KB: int | None = None
    run2_io_KB: int | None = None
    run3_io_KB: int | None = None
    ressize_KB: int | None = None

    def to_csv_row(self) -> list[Any]:
        return [
            self.query, self.status,
            self.run1_time_ns, self.run2_time_ns, self.run3_time_ns,
            None,  # Not Yet Implemented
            self.run1_io_KB, self.run2_io_KB, self.run3_io_KB, self.ressize_KB
        ]

def run_query(runner, db_path: Path, ios: IOStat, idx: str, tags: set, query: str, parameter: str, queryoutput: Path | None) -> QueryResult:
    """
    Runs a specific query 3 times (Cold, Warm, Warm) and records timing.
    """
    times: list[float] = []
    iostats: list[float] = []
    params = runner.get_parameters(parameter)
    for runidx in range(3):
        iteration_label = "Cold" if runidx == 0 else f"Warm-{runidx}"
        logger.info("[%s] Run %s/3 (%s): %s ...", idx, runidx+1, iteration_label, query[:50])
        if runidx == 0:
            subprocess.run([os.getenv('FLUSH'), db_path], check=True, capture_output=True)
        runner.prepare_run()
        gc.collect()
        io_start = ios.get_io_stat()
        t_start = time_mod.perf_counter_ns()
        try:
            res = runner.execute_query(idx, tags, query, params, runidx) # exclude preprocessing parameters from execution time
            t_end = time_mod.perf_counter_ns()
            io_end = ios.get_io_stat()
        except Exception as e:
            logger.error("Query %s failed: %s", idx, e)
            return QueryResult(query, "error")
        if runidx == 0:
            logger.info("[%s]   Shape of the result: %s x %s", idx, res.shape[0], res.shape[1])
            if queryoutput is not None:
                out_file = queryoutput / f"queryoutput_{idx}.csv"
                runner.write_csv(res, out_file)
        ressize_kb = runner.get_table_size(res)
        del res
        times.append(t_end - t_start)
        iostats.append(io_end - io_start)

    return QueryResult(query, "success", *times, *iostats, ressize_kb)


def main(args: argparse.Namespace) -> None:
    start_time: datetime = datetime.now()
    if not args.db.exists():
        logger.error("Database does not exist at %s", args.db)
        sys.exit(1)

    tags = set() if args.tags is None else set(args.tags.strip().split(","))
    if args.result is not None:
        args.result.parent.mkdir(parents=True, exist_ok=True)

    logger.info("Loading parameter files...")
    engine = args.engine.lower()
    params = load_parameters(args.paramdir)
    params["datadate"] = args.date
    storage_backend = args.storage_backend.lower()
    if storage_backend == "memory":
        if engine == "polars":
            if len(args.indexon) > 0:
                raise ValueError("Polars does not support indices")
            from executors.inmemory.polars import QueryExecutorPolarsInMemory
            import polars as pl
            runner = QueryExecutorPolarsInMemory(params, sort_cols=args.sortcols, datadate=args.date)
            threadnr = pl.thread_pool_size()
            engineversion = pl.__version__
        elif engine == "duckdb_con":
            from executors.inmemory.duckdb_con import QueryExecutorDuckDBCon
            import duckdb
            con = duckdb.connect()
            runner = QueryExecutorDuckDBCon(con, params, sort_cols=args.sortcols, index_on=args.indexon)
            if 'DUCKDB_THREADS' in os.environ:
                con.execute(f"SET threads = {os.environ['DUCKDB_THREADS']}")
            threadnr = con.sql("SELECT current_setting('threads')").fetchall()[0][0]
            engineversion = duckdb.__version__
            logger.info("Using DuckDB with %s threads", threadnr)
        elif engine == "pykx":
            from executors.inmemory.pykx import QueryExecutorPyKXInMemory
            import pykx as kx
            runner = QueryExecutorPyKXInMemory(params, sort_cols=args.sortcols, index_on=args.indexon)
            threadnr = max(1, kx.q.system.num_threads)
            engineversion = kx.__version__
        elif engine == "pandas":
            if len(args.indexon) > 0:
                raise ValueError("Pandas does not support indices")
            from executors.inmemory.pandas import QueryExecutorPandas
            import pandas as pd
            runner = QueryExecutorPandas(params, sort_cols=args.sortcols)
            import numexpr
            threadnr = os.environ.get('NUMEXPR_NUM_THREADS', numexpr.nthreads)
            engineversion = pd.__version__
        else:
            raise ValueError(f"Invalid engine parameter: {args.engine}")
    elif storage_backend == "disk":
        if engine == "polars":
            from executors.ondisk.polars import QueryExecutorPolars
            import polars as pl
            runner = QueryExecutorPolars(params)
            threadnr = pl.thread_pool_size()
            engineversion = pl.__version__
        elif engine == "pykx":
            from executors.ondisk.pykx import QueryExecutorPyKX
            import pykx as kx
            runner = QueryExecutorPyKX(params)
            threadnr = kx.q.system.num_threads
            engineversion = kx.__version__
        else:
            raise ValueError(f"Invalid engine parameter: {args.engine}")
    else:
        raise ValueError(f"Invalid storage_backend parameter: {args.storage_backend}")

    headers: list[str] = [
        "storagebackend", "compparam", "threadcount", "runner",
        "engine", "format", "sortcols", "indexon","engineversion",
        "idx", "query", "status",
        "run1timeNS", "run2timeNS", "run3timeNS",
        "run3memKB",
        "run1ioKB", "run2ioKB", "run3ioKB", "ressizeKB"
    ]
    row_start = [storage_backend, "nyi", threadnr, "Python", engine, "",
        ','.join(args.sortcols), ','.join(args.indexon), engineversion]
    ios = IOStat(args.db)
    file_ctx = (open(args.result, 'w', newline='', encoding='utf-8')
                if args.result is not None
                else contextlib.nullcontext(io.StringIO()))
    with file_ctx as f_out:
        writer = csv.writer(f_out, delimiter='|')
        if args.result is not None:
            writer.writerow(headers)

        runner.load_resources(db_path=args.db, datadate=args.date, writer=writer, row_start=row_start, ios=ios)
        f_out.flush()
        if args.table_stats_dir is not None:
            logger.info("Saving table statistics to %s", args.table_stats_dir)
            args.table_stats_dir.mkdir(parents=True, exist_ok=True)
            table_stats_dict = runner.get_table_stats()
            with open(args.table_stats_dir / "stats.yaml", 'w') as f:
                yaml.dump(table_stats_dict, f, indent=2, sort_keys=False)

        if not args.queryfile.exists():
            logger.error("Query file not found: %s", args.queryfile)
            sys.exit(3)

        if args.queryOutputDir is not None:
            args.queryOutputDir.mkdir(parents=True, exist_ok=True)

        with open(args.queryfile, 'r', encoding='utf-8') as queryfile, \
             open(args.querymeta, "r", encoding="utf-8") as querymeta:
            queryreader = csv.DictReader(queryfile, delimiter='|')
            querymetareader = csv.DictReader(querymeta, delimiter='|')

            for row, rowmeta in zip(queryreader, querymetareader):
                idx = row['idx'].strip()
                if idx != rowmeta['idx'].strip():
                    logger.error("Index mismatch between the query and the query meta files: %s vs %s", idx, rowmeta['idx'].strip())
                    sys.exit(4)
                query = row['query'].strip()
                querytags = set(row['tags'].strip().split(",") + rowmeta['tags'].strip().split(","))
                querytags.discard("")
                instrument = (rowmeta.get('instrument') or '').strip()
                # instrument is a base scope (single|multi|all) optionally refined
                # with a frequency, e.g. "single:infrequent".
                instrument_base = instrument.split(':', 1)[0]
                if instrument_base not in ('single', 'multi', 'all'):
                    logger.error("Missing or invalid instrument %r for query %s in the query meta file (expected single, multi or all, optionally :<frequency>)", instrument, idx)
                    sys.exit(4)
                if query.startswith("#"):
                    query = query[1:]
                    result = QueryResult(query, "skip")
                elif query == '':
                    result = QueryResult(query, "emptyquery")
                elif args.idx is not None and int(idx) not in args.idx:
                    result = QueryResult(query, "idxfiltered")
                elif len(tags) > 0 and len(tags & querytags) == 0:
                    result = QueryResult(query, "tagfiltered")
                elif args.instrument is not None and args.instrument not in (instrument, instrument_base):
                    result = QueryResult(query, "instrumentfiltered")
                else:
                    result = run_query(runner, args.db, ios, idx, querytags, query, row['parameter'].strip(), args.queryOutputDir)

                writer.writerow(row_start + [idx] + result.to_csv_row())
                f_out.flush()

    elapsed = datetime.now() - start_time
    if args.result is not None:
        logger.info("Benchmarking completed in %s. Results saved to %s", elapsed, args.result)
    else:
        logger.info("Benchmarking completed in %s.", elapsed)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Query Runner & Benchmarker using NYSE TAQ data",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter
    )

    parser.add_argument('-db', type=Path, required=True, help="Path to hive-partitioned parquet DB root")
    parser.add_argument('-storage_backend', type=str, choices=["memory", "disk"],
        required=True, help="Storage backend. Currently supported memory and disk")
    parser.add_argument('-engine', type=str, choices=["polars", "duckdb_con", "pykx", "pandas"],
        required=True, help="Query engine. Currently supported: polars, duckdb_con, pykx, and pandas")
    parser.add_argument('-sortcols', type=parse_sortcols, required=False, help="Comma-separated columns to sort trade/quote by, e.g. 'time' or 'sym,time'.")
    parser.add_argument('-indexon', type=parse_sortcols, required=False, default=[], help="Comma-separated columns to add index to, e.g. 'sym' or 'sym,ex'.")
    parser.add_argument('-queryfile', type=Path, required=True, help="PSV file containing queries")
    parser.add_argument('-querymeta', type=Path, required=True, help="PSV file containing the query metas")
    parser.add_argument('-paramdir', type=Path, required=True, help="Directory containing parameter txt files")
    parser.add_argument('-tags', type=str, required=False, help="Comma separated tags for filtering queries.")
    parser.add_argument('-instrument', type=str, required=False,
        choices=["single", "multi", "all",
                 "single:infrequent", "single:frequent",
                 "multi:50", "multi:1000infreq"],
        help="Only run queries with this instrument scope (the mandatory instrument column of the query meta file). "
             "A base scope like 'single' or 'multi' also matches its variants "
             "(single:infrequent/frequent, multi:50/1000infreq).")
    parser.add_argument('-queryOutputDir', type=Path, required=False, help="Directory to save query results.")
    parser.add_argument('-tableStatsDir', dest='table_stats_dir', type=Path, required=False, help="Directory to save master/trade/quote table statistics YAML files.")
    parser.add_argument('-date', type=lambda s: datetime.strptime(s, '%Y%m%d').date(), required=True, help='Date in YYYYMMDD format')

    parser.add_argument('-result', type=Path, default=None, help="Output PSV file path. If not provided, results are not written.")
    parser.add_argument('-idx', type=parse_idx_filter, default=None, help="Filter queries by index: single (42), list (32,42,50), or range (40-44).")

    return parser


if __name__ == '__main__':
    if os.getenv('FLUSH') is None:
        logger.error("Environment variable FLUSH is not set. Maybe config/queryenv was not loaded.")
        sys.exit(2)

    main(build_parser().parse_args())
