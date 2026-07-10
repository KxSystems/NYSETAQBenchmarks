#!/usr/bin/env python3
"""Convert NYSE TAQ benchmark results into a ClickBench-like result layout.

Given a benchmark result directory (e.g. results/inmemory/small/20260709) that
contains:

  * queryengines.psv   - the query/engine timing results (pipe separated)
  * <solution>/stats.yaml - per-solution table statistics
  * environment.yaml   - machine / test-run environment

this produces, under the output directory, one JSON file per
(solution, threadcount) pair:

  <output>/<solution>/<threadcount>/<machine>.json

where <machine> is the mapping of system.cpu.model taken from
results/mappings.yaml. The JSON mirrors the ClickBench result format
(see https://github.com/ClickHouse/ClickBench) with these differences:

  * dropped keys : cluster_size, concurrent_qps, concurrent_error_ratio
  * added key    : threadcount (the run's thread count)
  * system       : the solution name
  * date         : date part of environment.yaml "test time"
  * machine      : mappings.yaml["machines"][cpu.model]
  * proprietary  : from the solution's stats.yaml
  * hardware     : "cpu" (GPUs are not supported yet)
  * tuned        : "no"
  * tags         : []
  * load_time    : sum of run1timeNS over rows tagged "load"
  * data_size    : sum of "size (MB)" over tables in stats.yaml
  * result       : list of [run1timeNS, run2timeNS, run3timeNS] per query
"""

import argparse
import json
import re
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

import yaml

MONTHS = {
    "Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
    "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12,
}


def normalize(name: str) -> str:
    """Loose key for matching solution names to stats directories.

    e.g. the PSV solution ``duckdbIndex`` matches the directory ``duckdb_index``.
    """
    return re.sub(r"[^a-z0-9]", "", name.lower())


def parse_test_date(test_time: str) -> str:
    """Extract the ISO date (YYYY-MM-DD) from a ctime-style "test time" string.

    Example input: ``Thu Jul  9 11:53:40 PM PDT 2026`` -> ``2026-07-09``.
    The timezone token is not parsed (strptime %Z is unreliable), so we read
    the fixed positional fields instead.
    """
    parts = test_time.split()
    if len(parts) < 3 or parts[1] not in MONTHS:
        raise ValueError(f"Unrecognized test time format: {test_time!r}")
    month = MONTHS[parts[1]]
    day = int(parts[2])
    year = int(parts[-1])
    return f"{year:04d}-{month:02d}-{day:02d}"


def find_mappings(input_dir: Path) -> Path:
    """Locate mappings.yaml by walking up from the input directory."""
    for parent in [input_dir, *input_dir.parents]:
        candidate = parent / "mappings.yaml"
        if candidate.is_file():
            return candidate
    raise FileNotFoundError(
        f"Could not find mappings.yaml in {input_dir} or any parent directory"
    )


def parse_stats(stats_path: Path):
    """Return (proprietary, data_size_mb) from a solution's stats.yaml.

    The file comes in two shapes: a nested mapping (one key per table) and a
    flat concatenation of table documents. Both keep ``proprietary`` on the
    first line and repeat ``size (MB):`` once per table, so we read those two
    fields directly with regexes rather than fully parsing (a plain YAML load
    would collapse the flat form's duplicate keys and lose sizes).
    """
    text = stats_path.read_text()

    prop_match = re.search(r"^\s*proprietary\s*:\s*(.+?)\s*$", text, re.MULTILINE)
    proprietary = None
    if prop_match:
        proprietary = prop_match.group(1).strip().strip("'\"")

    total = None
    for raw in re.findall(r"size \(MB\)\s*:\s*(\S+)", text):
        if raw.lower() in ("null", "none", "~"):
            continue
        try:
            value = float(raw)
        except ValueError:
            continue
        total = value if total is None else total + value
    if total is not None and total == int(total):
        total = int(total)

    return proprietary, total


def to_int(value: str):
    """Parse a nanosecond timing cell; blank/missing cells become None."""
    value = (value or "").strip()
    return int(value) if value else None


def load_psv(psv_path: Path):
    """Group PSV rows by (solution, threadcount).

    Returns a dict keyed by (solution, threadcount) -> {"load": [rows], "query": [rows]}
    and the ordered list of solutions as first seen in the file.
    """
    grouped = defaultdict(lambda: {"load": [], "query": []})
    solutions = []
    seen = set()

    with psv_path.open(newline="") as fh:
        header = fh.readline().rstrip("\n").split("|")
        col = {name: i for i, name in enumerate(header)}
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            fields = line.split("|")
            solution = fields[col["solution"]]
            threadcount = int(fields[col["threadcount"]])
            tags = fields[col["tags"]].split(",")
            row = {
                "idx": int(fields[col["idx"]]),
                "run1": to_int(fields[col["run1timeNS"]]),
                "run2": to_int(fields[col["run2timeNS"]]),
                "run3": to_int(fields[col["run3timeNS"]]),
            }
            kind = "load" if "load" in tags else "query"
            grouped[(solution, threadcount)][kind].append(row)

            if solution not in seen:
                seen.add(solution)
                solutions.append(solution)

    return grouped, solutions


def build_entry(solution, threadcount, rows, date, machine, proprietary, data_size):
    load_time = sum(r["run1"] for r in rows["load"] if r["run1"] is not None)
    query_rows = sorted(rows["query"], key=lambda r: r["idx"])
    result = [[r["run1"], r["run2"], r["run3"]] for r in query_rows]

    return OrderedDict([
        ("system", solution),
        ("date", date),
        ("machine", machine),
        ("threadcount", threadcount),
        ("proprietary", proprietary),
        ("hardware", "cpu"),
        ("tuned", "no"),
        ("tags", []),
        ("load_time", load_time),
        ("data_size", data_size),
        ("result", result),
    ])


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_dir", type=Path,
                        help="Benchmark result directory (e.g. results/inmemory/small/20260709)")
    parser.add_argument("output_dir", type=Path,
                        help="Directory to write the ClickBench-like output into")
    parser.add_argument("--mappings", type=Path, default=None,
                        help="Path to mappings.yaml (default: search parents of input_dir)")
    args = parser.parse_args()

    input_dir = args.input_dir
    if not input_dir.is_dir():
        parser.error(f"Input directory does not exist: {input_dir}")

    # Environment: date + machine.
    env = yaml.safe_load((input_dir / "environment.yaml").read_text())
    date = parse_test_date(env["test time"])
    cpu_model = env["system"]["cpu"]["model"]

    mappings_path = args.mappings or find_mappings(input_dir)
    mappings = yaml.safe_load(mappings_path.read_text())
    machines = mappings.get("machines", {})
    if cpu_model not in machines:
        parser.error(
            f"CPU model {cpu_model!r} not found in {mappings_path} 'machines' mapping. "
            "Add an entry to mappings.yaml."
        )
    machine = machines[cpu_model]

    # Per-solution stats (proprietary + data_size), matched by normalized name.
    stats_dirs = {normalize(p.name): p for p in input_dir.iterdir()
                  if p.is_dir() and (p / "stats.yaml").is_file()}

    grouped, solutions = load_psv(input_dir / "queryengines.psv")

    written = 0
    for solution in solutions:
        stats_dir = stats_dirs.get(normalize(solution))
        if stats_dir is None:
            proprietary, data_size = None, None
            print(f"warning: no stats.yaml directory found for solution "
                  f"{solution!r}; proprietary/data_size set to null", file=sys.stderr)
        else:
            proprietary, data_size = parse_stats(stats_dir / "stats.yaml")

        threadcounts = sorted({tc for (sol, tc) in grouped if sol == solution})
        for threadcount in threadcounts:
            rows = grouped[(solution, threadcount)]
            entry = build_entry(solution, threadcount, rows, date, machine,
                                 proprietary, data_size)

            out_dir = args.output_dir / solution / str(threadcount)
            out_dir.mkdir(parents=True, exist_ok=True)
            out_path = out_dir / f"{machine}.json"
            with out_path.open("w") as fh:
                json.dump(entry, fh, indent=4)
                fh.write("\n")
            written += 1
            print(f"wrote {out_path}")

    print(f"\nDone: {written} result file(s) for {len(solutions)} solution(s) "
          f"on machine {machine!r}.")


if __name__ == "__main__":
    main()
