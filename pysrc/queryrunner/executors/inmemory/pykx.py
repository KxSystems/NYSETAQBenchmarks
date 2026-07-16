import logging
import os
import time
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import pykx as kx

logger = logging.getLogger(__name__)


class QueryExecutorPyKXInMemory:
    """
    Handles the setup, execution of KDB-X Python queries
    on NYSE TAQ kdb+ database (single partition loaded into memory).
    """
    def __init__(self, param: dict[str, Any], sort_cols: str | list[str], index_on: str | list[str]) -> None:
        self.params: dict[str, Any] = param
        self.index_on: str | list[str] = index_on
        self.sort_cols: str | list[str] = sort_cols
        kx.q['timeBucketsStep'] = kx.q('{`s#value[x]!key x}', param['timeBuckets'])
        kx.q._register("./src/pivot")
        kx.pivot = kx.q('.pvt.pivot')
        self.eval_context: dict[str, Any] = {
            "kx": kx,
            "timedelta": timedelta,
            **param,
        }

    def load_resources(self, db_path: Path, datadate: date, writer, row_start, ios) -> None:
        dpath = db_path / datadate.strftime('%Y.%m.%d')
        logger.info("loading kdb+ tables at %s", dpath)

        io_load_start = ios.get_io_stat()
        t_load_start = time.perf_counter_ns()
        kx.q(f"sym: get `:{db_path}/sym")
        kx.q(f"exnames: get `:{db_path}/exnames")
        master = kx.q.get(dpath / "master").select(where=kx.Column('i') > -1)
        logger.info("Shape of master: %s x %s", master.shape[0], master.shape[1])
        trade = kx.q.get(dpath / "trade").select(where=kx.Column('i') > -1)
        logger.info("Shape of trade: %s x %s", trade.shape[0], trade.shape[1])
        quote = kx.q.get(dpath / "quote").select(where=kx.Column('i') > -1)
        logger.info("Shape of quote: %s x %s", quote.shape[0], quote.shape[1])
        t_load_elapsed = time.perf_counter_ns() - t_load_start
        io_load_end = ios.get_io_stat()
        writer.writerow(row_start + [0, "load a partition into memory", "success", t_load_elapsed, None, None,
                         None, io_load_end - io_load_start, None, None, sum(filter(None, [self.get_table_size(master), self.get_table_size(trade), self.get_table_size(quote)])) or None])


        io_load_start = ios.get_io_stat()
        t_load_start = time.perf_counter_ns()
        logger.info("ordering trade by %s", ','.join(self.sort_cols))
        trade = trade.sort_values(by=self.sort_cols)
        logger.info("ordering quote by %s", ','.join(self.sort_cols))
        quote = quote.sort_values(by=self.sort_cols)
        t_load_elapsed = time.perf_counter_ns() - t_load_start
        io_load_end = ios.get_io_stat()
        writer.writerow(row_start + [-2, "sort", "success", t_load_elapsed, None, None,
                         None, io_load_end - io_load_start, None, None, sum(filter(None, [self.get_table_size(master), self.get_table_size(trade), self.get_table_size(quote)])) or None])

        if len(self.index_on) > 0:
            io_load_start = ios.get_io_stat()
            t_load_start = time.perf_counter_ns()
            # TOOD: replicate getAttrib logic of src/runQueries.q
            for c in self.index_on:
                logger.info("adding index (grouped attribute) on %s in trade", c)
                trade.grouped(c)
                logger.info("adding index (grouped attribute) on %s in quote", c)
                quote.grouped(c)
            t_load_elapsed = time.perf_counter_ns() - t_load_start
            io_load_end = ios.get_io_stat()
            writer.writerow(row_start + [-3, "index", "success", t_load_elapsed, None, None,
                             None, io_load_end - io_load_start, None, None, sum(filter(None, [self.get_table_size(master), self.get_table_size(trade), self.get_table_size(quote)])) or None])

        self.eval_context["master"] = master
        self.eval_context["trade"] = trade
        self.eval_context["quote"] = quote


    @staticmethod
    def get_table_size(df) -> None:
        return None

    def get_table_stats(self) -> dict[str, Any]:
        table_stats_dict = {"proprietary": "yes"}
        for t_name in ["master", "trade", "quote"]:
            df = self.eval_context[t_name]
            table_stats = {
                "name": t_name,
                "size (MB)": (s / 1024 if (s := self.get_table_size(df)) is not None else None),
                "rowCount": len(df),
                "columnCount": df.shape[1].py(),
                "columns": [{"name": n.py(), "type": t.py().decode()} for n, t in zip(df.dtypes["columns"], df.dtypes["datatypes"])],
            }
            table_stats_dict[t_name] = table_stats
        return table_stats_dict

    def prepare_run(self) -> None:
        pass

    def get_parameters(self, parameter: str) -> str:
        return parameter

    def execute_query(self, idx: int, tags: set, query_str: str, parameter: str, runidx: int):
        return eval(query_str, self.eval_context)

    def write_csv(self, res, out_file: Path) -> None:
        kx.q.write.csv(out_file, res)
