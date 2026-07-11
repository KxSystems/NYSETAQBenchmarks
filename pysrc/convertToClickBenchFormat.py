#!/usr/bin/env python3
"""Convert NYSE TAQ benchmark results into a ClickBench-like data.js file.

The input directory is a <SIZE> directory (SIZE is one of small, medium, large
or full), e.g. ``results/inmemory/small``. It is scanned recursively for
benchmark runs; a run is any directory that contains both:

  * queryengines.psv      - the query/engine timing results (pipe separated)
  * environment.yaml      - machine / test-run environment

alongside per-solution ``<solution>/stats.yaml`` table statistics. The run
directory's name is its TESTDATE.

Every run contributes one entry per solution, keyed by the
(datadate, machine, solution) triple. When several runs share a triple, only
the entry from the run with the latest "test date" is kept.

The kept entries are written to a single JavaScript file in the style of
https://github.com/ClickHouse/ClickBench/blob/main/data.generated.js :

  const data = [
  ,{...}
  ,{...}
  ];

where each ``{...}`` is one benchmark entry serialised on a single line. Each
entry mirrors the ClickBench result format with these differences:

  * dropped keys : cluster_size, serverless, concurrent_qps, concurrent_error_ratio
  * solution     : corresponds to ClickBench's "system" key
  * date         : environment.yaml "test date"
  * machine      : mappings.yaml["machines"][cpu.model]
  * proprietary  : from the solution's stats.yaml
  * hardware     : "cpu" (GPUs are not supported yet)
  * tuned        : "no"
  * tags         : []
  * load_time    : {load phase -> thread count -> run1timeNS} for the load
                   phases present ("load a partition into memory", "transform",
                   "sort", "index")
  * data_size    : sum of "size (MB)" over tables in stats.yaml
  * result       : {thread count -> [[run1, run2, run3], ...]} per query
"""

import argparse
import json
import re
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

import yaml

VALID_SIZES = ("small", "medium", "large", "full")


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
                "desc": fields[col["query"]],
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


def build_load_time(solution, threadcounts, grouped):
    """load_time as {load phase -> {thread count -> run1timeNS}}.

    Phases are ordered by their PSV idx descending (0, -1, -2, -3), i.e. the
    natural pipeline order: load a partition into memory, transform, sort, index.
    """
    # phase description -> representative idx (for ordering)
    phase_idx = {}
    # thread count -> {phase description -> run1timeNS}
    per_tc = {tc: {} for tc in threadcounts}
    for tc in threadcounts:
        for row in grouped[(solution, tc)]["load"]:
            per_tc[tc][row["desc"]] = row["run1"]
            phase_idx.setdefault(row["desc"], row["idx"])

    load_time = OrderedDict()
    for desc in sorted(phase_idx, key=lambda d: phase_idx[d], reverse=True):
        load_time[desc] = OrderedDict(
            (str(tc), per_tc[tc][desc]) for tc in threadcounts if desc in per_tc[tc]
        )
    return load_time


def build_result(solution, threadcounts, grouped):
    """result as {thread count -> [[run1, run2, run3], ...]} ordered by query idx."""
    result = OrderedDict()
    for tc in threadcounts:
        query_rows = sorted(grouped[(solution, tc)]["query"], key=lambda r: r["idx"])
        result[str(tc)] = [[r["run1"], r["run2"], r["run3"]] for r in query_rows]
    return result


def build_entry(solution, threadcounts, grouped, date, machine, proprietary, data_size):
    return OrderedDict([
        ("solution", solution),
        ("date", date),
        ("machine", machine),
        ("proprietary", proprietary),
        ("hardware", "cpu"),
        ("tuned", "no"),
        ("tags", []),
        ("load_time", build_load_time(solution, threadcounts, grouped)),
        ("data_size", data_size),
        ("result", build_result(solution, threadcounts, grouped)),
    ])


def process_run(run_dir: Path, machines: dict, mappings_path: Path):
    """Build one entry per solution for a single benchmark run directory.

    Yields (datadate, machine, solution, date, entry) tuples.
    """
    testdate = run_dir.name
    env = yaml.safe_load((run_dir / "environment.yaml").read_text())
    date = str(env["test date"])
    datadate = str(env["parameters"]["datadate"])
    cpu_model = env["system"]["cpu"]["model"]

    # The directory TESTDATE should agree with the environment's test date.
    if re.sub(r"\D", "", testdate) != re.sub(r"\D", "", date):
        print(f"warning: run directory TESTDATE {testdate!r} does not match "
              f"environment.yaml test date {date!r} in {run_dir}", file=sys.stderr)

    if cpu_model not in machines:
        raise SystemExit(
            f"CPU model {cpu_model!r} (from {run_dir}) not found in "
            f"{mappings_path} 'machines' mapping. Add an entry to mappings.yaml."
        )
    machine = machines[cpu_model]

    # Per-solution stats (proprietary + data_size), keyed by directory name.
    stats_dirs = {p.name: p for p in run_dir.iterdir()
                  if p.is_dir() and (p / "stats.yaml").is_file()}

    grouped, solutions = load_psv(run_dir / "queryengines.psv")

    for solution in solutions:
        stats_dir = stats_dirs.get(solution)
        if stats_dir is None:
            proprietary, data_size = None, None
            print(f"warning: no stats.yaml directory found for solution "
                  f"{solution!r} in {run_dir}; proprietary/data_size set to null",
                  file=sys.stderr)
        else:
            proprietary, data_size = parse_stats(stats_dir / "stats.yaml")

        threadcounts = sorted({tc for (sol, tc) in grouped if sol == solution})
        entry = build_entry(solution, threadcounts, grouped, date, machine,
                            proprietary, data_size)
        yield datadate, machine, solution, date, entry


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_dir", type=Path,
                        help="A <SIZE> benchmark directory to scan "
                             "(e.g. results/inmemory/small)")
    parser.add_argument("output_file", type=Path,
                        help="Path of the .js file to write")
    parser.add_argument("--mappings", type=Path, default=None,
                        help="Path to mappings.yaml (default: search parents of input_dir)")
    args = parser.parse_args()

    input_dir = args.input_dir.resolve()
    if not input_dir.is_dir():
        parser.error(f"Input directory does not exist: {input_dir}")
    if input_dir.name not in VALID_SIZES:
        parser.error(
            f"Input directory must be a <SIZE> directory with SIZE in "
            f"{VALID_SIZES}; got {input_dir.name!r} from {input_dir}"
        )

    mappings_path = args.mappings or find_mappings(input_dir)
    machines = yaml.safe_load(mappings_path.read_text()).get("machines", {})

    # Discover runs: any directory holding both environment.yaml and queryengines.psv.
    run_dirs = sorted({env.parent for env in input_dir.rglob("environment.yaml")
                       if (env.parent / "queryengines.psv").is_file()})
    if not run_dirs:
        parser.error(f"No benchmark runs (environment.yaml + queryengines.psv) "
                     f"found under {input_dir}")

    # Keep only the latest-dated entry per (datadate, machine, solution) triple.
    latest = {}
    for run_dir in run_dirs:
        for datadate, machine, solution, date, entry in process_run(
                run_dir, machines, mappings_path):
            key = (datadate, machine, solution)
            if key not in latest or date > latest[key][0]:
                latest[key] = (date, entry)

    entries = [latest[key][1] for key in sorted(latest)]

    # Match ClickBench data.generated.js: leading commas on every entry except
    # the first (a leading comma on the first line would create an array hole),
    # each entry serialised compactly on one line.
    with args.output_file.open("w") as fh:
        fh.write("const data = [\n")
        for i, entry in enumerate(entries):
            prefix = "" if i == 0 else ","
            fh.write(prefix + json.dumps(entry, ensure_ascii=False,
                                         separators=(",", ":")) + "\n")
        fh.write("];\n")

    print(f"wrote {args.output_file}: {len(entries)} entr"
          f"{'y' if len(entries) == 1 else 'ies'} from {len(run_dirs)} run(s).")


if __name__ == "__main__":
    main()
