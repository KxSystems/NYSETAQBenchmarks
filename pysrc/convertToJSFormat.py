#!/usr/bin/env python3
"""Convert NYSE TAQ benchmark results into a javascript file for the dashboard (index.html).

The input directory (e.g. ``results/inmemory/small``) is scanned recursively
for benchmark runs; a run is any directory that contains both:

  * results.psv           - the query/engine timing results (pipe separated)
  * environment.yaml      - machine / test-run environment

alongside per-solution ``<solution>/stats.yaml`` table statistics. The run's
"test date" is taken from environment.yaml; directory names carry no meaning.

Entries are keyed by the (datadate, machine, solution, numanode) tuple. A key's
measurements may be split across several run directories (e.g. one directory
per thread count); all their thread counts are merged into a single entry.
When the same thread count of a key appears in several runs, only the run
with the latest "test date" is kept; proprietary, engineversion and data_size
come from the latest run overall.

The NUMA node is part of the key rather than just a reported field: a run pinned
to one node with ``numactl`` and an unpinned one see different core counts and
memory bandwidth, so their thread counts must not be merged into a single entry
as if they were one scaling curve.

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
  * datadate     : the data date (parameters.datadate), ISO-formatted (replaces
                   ClickBench's "date"); the environment "test date" is used
                   only to pick the latest run per triple
  * machine      : mappings.yaml["machines"][cpu.model]
  * numanode     : the NUMANODE the run was pinned to with numactl, from
                   environment.yaml "envvars"; ``NUMANODE_UNPINNED`` ("all") when
                   the variable was empty, i.e. the run could use every node
  * proprietary  : from the solution's stats.yaml
  * engineversion : version of the engine library, from the solution's
                   stats.yaml (null for runs predating the field)
  * sortcols     : comma-separated columns trade/quote were sorted by, from
                   the solution's stats.yaml (null for runs predating the
                   field)
  * hardware     : "cpu" (GPUs are not supported yet)
  * tags         : []
  * load_time    : {load phase -> thread count -> run1timeNS} for the load
                   phases present ("load a partition into memory", "transform",
                   "sort", "index")
  * data_size    : sum of "size (MB)" over tables in stats.yaml
  * max_res_mem_kb : "Maximum resident set size (kbytes)" of the solution's
                   process, from the per-solution os.txt (/usr/bin/time -v
                   output)
  * exitcode     : 0 for a solution that produced query results; the "Exit
                   status" its runner reported in os.txt when it produced none
                   (see below)
  * engine       : the results.psv "engine" column (e.g. q-sql, duckdb_con),
                   used by index.html to pick a query formatter
  * queries      : the query texts the solution ran (results.psv "query"
                   column), aligned with the result arrays
  * result       : {thread count -> [[run1, run2, run3], ...]} per query

A solution whose runner the operating system killed - running out of memory on a
data size that does not fit is the usual cause - never gets to run a query:
``run_solution`` swallows the exit status, so at most its load rows reach
results.psv. Both runners write the solution-level part of
``<solution>/stats.yaml`` before they load any data, though, so such a run is
identified by its stats.yaml (labelled with the solution name by
``add_solution_name``) next to a non-zero "Exit status" in its
``<solution>/os.txt``. It gets an entry with an empty ``result`` and that exit
status as its ``exitcode``, so the dashboard can report the failure rather than
omitting the solution silently. Its load rows are dropped rather than reported:
they time a load that never finished, so ranking the solution on them would credit
it for work it did not complete.

After the data array the file also carries ``const machine_environments``,
mapping each machine name to the raw environment.yaml text of that machine's
latest run (by "test date" / "test time"); index.html shows it as a hover
tooltip on the machine selectors.

Alongside the data file this also refreshes
``artifacts/queries/inmemory/querymeta.generated.js``, a copy of querymeta.psv
and tags.psv embedded as JavaScript strings. index.html normally fetches these
PSVs directly, but browsers block fetch() when the page is opened via file://,
and the page then falls back to this generated copy.
"""

import argparse
import json
import re
import sys
from collections import OrderedDict, defaultdict
from pathlib import Path

import yaml

QUERYMETA_PSV = (Path(__file__).resolve().parent.parent
                 / "artifacts" / "queries" / "inmemory" / "querymeta.psv")

# Value reported for a run that was not pinned to a NUMA node (empty NUMANODE),
# i.e. one free to use all of them. Kept out of the numeric node names on purpose.
NUMANODE_UNPINNED = "all"

# Stands in for the thread count of a failed solution, which has none: its runner
# was killed before it reported a single measurement.
FAILED = None


def write_querymeta_js():
    """Embed querymeta.psv and tags.psv into querymeta.generated.js, the file:// fallback of index.html."""
    out = QUERYMETA_PSV.with_name("querymeta.generated.js")
    header = ("// Generated by pysrc/convertToJSFormat.py from querymeta.psv"
              " and tags.psv - do not edit.\n")
    text = header + ("const querymeta_psv = "
                     + json.dumps(QUERYMETA_PSV.read_text()) + ";\n")
    tags = QUERYMETA_PSV.with_name("tags.psv")
    if tags.is_file():
        text += "const tags_psv = " + json.dumps(tags.read_text()) + ";\n"
    out.write_text(text)
    print(f"wrote {out}")


def parse_stats(stats_path: Path):
    """Return (proprietary, engineversion, sortcols, data_size_mb) from a solution's stats.yaml.

    The file comes in two shapes: a nested mapping (one key per table) and a
    flat concatenation of table documents. Both keep ``proprietary`` (and,
    since they were added, ``engineversion`` and ``sortcols``) as top-level
    scalars and repeat ``size (MB):`` once per table, so we read these fields
    directly with regexes rather than fully parsing (a plain YAML load would
    collapse the flat form's duplicate keys and lose sizes).
    """
    text = stats_path.read_text()

    prop_match = re.search(r"^\s*proprietary\s*:\s*(.+?)\s*$", text, re.MULTILINE)
    proprietary = None
    if prop_match:
        proprietary = prop_match.group(1).strip().strip("'\"")

    version_match = re.search(r"^\s*engineversion\s*:\s*(.+?)\s*$", text, re.MULTILINE)
    engineversion = None
    if version_match:
        engineversion = version_match.group(1).strip().strip("'\"")

    sortcols_match = re.search(r"^sortcols\s*:\s*(.+?)\s*$", text, re.MULTILINE)
    sortcols = None
    if sortcols_match:
        sortcols = sortcols_match.group(1).strip().strip("'\"") or None

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

    return proprietary, engineversion, sortcols, total


def parse_exit_status(os_txt_path: Path):
    """The exit status of a solution's runner, from the ``/usr/bin/time -v`` output.

    ``time -v`` reports it on its last line as "Exit status: <n>" (and repeats a
    non-zero one near the top as "Command exited with non-zero status <n>", after
    whatever the process itself wrote to stderr - hence matching anywhere in the
    file rather than at a fixed line). None when the file or the line is missing.

    Note that run_solution overwrites os.txt per thread count, so this is the
    status of the last thread count the solution was run with.
    """
    if not os_txt_path.is_file():
        return None
    match = re.search(r"^\s*Exit status:\s*(\d+)\s*$", os_txt_path.read_text(), re.MULTILINE)
    return int(match.group(1)) if match else None


def parse_max_res_mem(os_txt_path: Path):
    """Return "Maximum resident set size (kbytes)" from a solution's os.txt.

    The file is the ``/usr/bin/time -v`` output of the solution's benchmark
    process; None when the file or the line is missing.
    """
    if not os_txt_path.is_file():
        return None
    match = re.search(r"Maximum resident set size \(kbytes\)\s*:\s*(\d+)",
                      os_txt_path.read_text())
    return int(match.group(1)) if match else None


def numanode_of(env: dict):
    """The NUMA node a run was pinned to, from environment.yaml "envvars".

    common.sh writes ``NUMANODE: "${NUMANODE:-}"`` and only builds a ``numactl``
    prefix when it is non-empty, so an empty (or absent) value means the run was
    free to use every node - reported as NUMANODE_UNPINNED.
    """
    envvars = env.get("envvars") or {}
    value = envvars.get("NUMANODE")
    # An absent key, an explicit YAML null and "" all mean "not pinned".
    return NUMANODE_UNPINNED if value is None else (str(value).strip() or NUMANODE_UNPINNED)


def cpu_model_of(env: dict):
    """The cpu model of a loaded environment.yaml; some runs capitalize the key."""
    cpu = env["system"]["cpu"]
    return cpu.get("model", cpu.get("Model"))


def to_int(value: str):
    """Parse a nanosecond timing cell; blank/missing cells become None."""
    value = (value or "").strip()
    return int(value) if value else None


def unquote(field: str):
    """Undo the CSV-style quoting of results.psv cells that contain quotes."""
    if len(field) >= 2 and field.startswith('"') and field.endswith('"'):
        return field[1:-1].replace('""', '"')
    return field


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
            row = {
                "idx": int(fields[col["idx"]]),
                "desc": unquote(fields[col["query"]]),
                "run1": to_int(fields[col["run1timeNS"]]),
                "run2": to_int(fields[col["run2timeNS"]]),
                "run3": to_int(fields[col["run3timeNS"]]),
            }
            # load phases are written with idx <= 0 (0, -1, -2, -3), queries start at 1
            kind = "load" if row["idx"] <= 0 else "query"
            grouped[(solution, threadcount)][kind].append(row)
            if "engine" in col:
                grouped[(solution, threadcount)]["engine"] = fields[col["engine"]]

            if solution not in seen:
                seen.add(solution)
                solutions.append(solution)

    return grouped, solutions


def build_load_time(runs):
    """load_time as {load phase -> {thread count -> run1timeNS}}.

    ``runs`` maps thread count -> {"load": rows, "query": rows}. Phases are
    ordered by their PSV idx descending (0, -1, -2, -3), i.e. the natural
    pipeline order: load a partition into memory, transform, sort, index.
    """
    # phase description -> representative idx (for ordering)
    phase_idx = {}
    # thread count -> {phase description -> run1timeNS}
    per_tc = {tc: {} for tc in runs}
    for tc, rows in runs.items():
        for row in rows["load"]:
            per_tc[tc][row["desc"]] = row["run1"]
            phase_idx.setdefault(row["desc"], row["idx"])

    load_time = OrderedDict()
    for desc in sorted(phase_idx, key=lambda d: phase_idx[d], reverse=True):
        load_time[desc] = OrderedDict(
            (str(tc), per_tc[tc][desc]) for tc in sorted(runs) if desc in per_tc[tc]
        )
    return load_time


def build_result(runs):
    """result as {thread count -> [[run1, run2, run3], ...]} ordered by query idx."""
    result = OrderedDict()
    for tc in sorted(runs):
        query_rows = sorted(runs[tc]["query"], key=lambda r: r["idx"])
        result[str(tc)] = [[r["run1"], r["run2"], r["run3"]] for r in query_rows]
    return result


def build_queries(runs):
    """The query texts the solution ran, aligned with the result arrays."""
    texts = {}
    for tc in sorted(runs):
        for row in runs[tc]["query"]:
            texts[row["idx"]] = row["desc"]
    return [texts[idx] for idx in sorted(texts)]


def build_entry(solution, runs, date, machine, numanode, proprietary, engineversion,
                sortcols, data_size, max_res_mem, exitcode):
    engines = {payload["engine"] for payload in runs.values() if "engine" in payload}
    return OrderedDict([
        ("solution", solution),
        ("datadate", date),
        ("machine", machine),
        ("numanode", numanode),
        ("engine", engines.pop() if engines else None),
        ("engineversion", engineversion),
        ("sortcols", sortcols),
        ("proprietary", proprietary),
        ("hardware", "cpu"),
        ("tags", []),
        ("load_time", build_load_time(runs)),
        ("data_size", data_size),
        ("max_res_mem_kb", max_res_mem),
        ("exitcode", exitcode),
        ("queries", build_queries(runs)),
        ("result", build_result(runs)),
    ])


def process_run(run_dir: Path, machines: dict, mappings_path: Path):
    """Extract per-(solution, thread count) measurements from one run directory.

    Yields (datadate, machine, solution, numanode, threadcount, date, payload)
    tuples, where payload holds the load/query rows for that thread count plus the
    solution's proprietary/data_size stats. A solution whose runner was killed is
    yielded once with the FAILED thread count and no load/query rows.
    """
    env = yaml.safe_load((run_dir / "environment.yaml").read_text())
    date = str(env["test date"])
    numanode = numanode_of(env)
    datadate = str(env["parameters"]["datadate"])
    # ISO-format an 8-digit datadate (20260401 -> 2026-04-01); leave any other
    # format untouched.
    datadate = (f"{datadate[:4]}-{datadate[4:6]}-{datadate[6:8]}"
                if re.fullmatch(r"\d{8}", datadate) else datadate)
    cpu_model = cpu_model_of(env)

    if cpu_model not in machines:
        raise SystemExit(
            f"CPU model {cpu_model!r} (from {run_dir}) not found in "
            f"{mappings_path} 'machines' mapping. Add an entry to mappings.yaml."
        )
    machine = machines[cpu_model]

    # The stats directory of each solution the run attempted, keyed by the name
    # add_solution_name recorded on the stats.yaml "solution" line. The directory
    # name is the sanitised form of it ("DuckDB (Index)" -> "DuckDB_Index_") and so
    # cannot be turned back into a solution name; the "solution" line is the only
    # record of it.
    stats_dirs = {}
    for path in sorted(run_dir.iterdir()):
        if not path.is_dir():
            continue
        stats = path / "stats.yaml"
        if not stats.is_file():
            # Both runners write the solution-level part of stats.yaml before
            # loading, so this only happens for a run made before they did.
            if parse_exit_status(path / "os.txt"):
                print(f"warning: {path} holds a failed run without a stats.yaml, "
                      f"so the solution it ran is unknown; skipped", file=sys.stderr)
            continue
        sol_match = re.search(r"^solution\s*:\s*(.+?)\s*$", stats.read_text(), re.MULTILINE)
        if sol_match is None:
            print(f"warning: {stats} has no 'solution' line, so the solution it "
                  f"describes is unknown; skipped", file=sys.stderr)
            continue
        stats_dirs[sol_match.group(1).strip().strip("'\"")] = path

    grouped, solutions = load_psv(run_dir / "results.psv")

    # Thread counts that ran at least one query. A runner killed while loading can
    # still have written its load rows (all of them, at every thread count), and
    # those describe a load that never finished: reporting them would rank the
    # solution on a partial load and, with an empty query list, leave index.html
    # with a zero-length result row. So only measured thread counts are reported,
    # and a solution left without any is reported as failed below.
    measured = {(sol, tc) for (sol, tc), rows in grouped.items() if rows["query"]}

    for solution in solutions:
        stats_dir = stats_dirs.get(solution)
        if stats_dir is None:
            proprietary, engineversion, sortcols, data_size, max_res_mem = None, None, None, None, None
            print(f"warning: no stats.yaml directory found for solution "
                  f"{solution!r} in {run_dir}; proprietary/engineversion/"
                  f"sortcols/data_size/max_res_mem_kb set to null", file=sys.stderr)
        else:
            proprietary, engineversion, sortcols, data_size = parse_stats(stats_dir / "stats.yaml")
            max_res_mem = parse_max_res_mem(stats_dir / "os.txt")

        for tc in sorted(tc for (sol, tc) in measured if sol == solution):
            payload = dict(grouped[(solution, tc)],
                           proprietary=proprietary, engineversion=engineversion,
                           sortcols=sortcols,
                           data_size=data_size, max_res_mem=max_res_mem)
            yield datadate, machine, solution, numanode, tc, date, payload

    # Solutions that failed before they ran a single query - the operating system
    # killing the runner for exceeding the available memory is the usual cause.
    # Their stats.yaml names them and reports the fields written before the load;
    # data_size stays null because nothing finished loading.
    for solution, stats_dir in stats_dirs.items():
        if any(sol == solution for (sol, _) in measured):
            continue
        exitcode = parse_exit_status(stats_dir / "os.txt")
        if not exitcode:
            print(f"warning: solution {solution!r} in {run_dir} ran no query yet its "
                  f"runner reported exit status {exitcode}; skipped", file=sys.stderr)
            continue
        proprietary, engineversion, sortcols, _ = parse_stats(stats_dir / "stats.yaml")
        yield datadate, machine, solution, numanode, FAILED, date, {
            "proprietary": proprietary, "engineversion": engineversion,
            "sortcols": sortcols, "data_size": None, "max_res_mem": None,
            "exitcode": exitcode,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_dir", type=Path,
                        help="Benchmark results directory to scan recursively "
                             "(e.g. results/inmemory/small)")
    parser.add_argument("output_file", type=Path,
                        help="Path of the .js file to write")
    parser.add_argument("--mappings", type=Path,
                        default=Path("./results/mappings.yaml"),
                        help="Path to mappings.yaml (default: %(default)s)")
    args = parser.parse_args()

    input_dir = args.input_dir.resolve()
    if not input_dir.is_dir():
        parser.error(f"Input directory does not exist: {input_dir}")

    mappings_path = args.mappings
    if not mappings_path.is_file():
        parser.error(f"mappings.yaml not found: {mappings_path}")
    machines = yaml.safe_load(mappings_path.read_text()).get("machines", {})

    # Discover runs: any directory holding both environment.yaml and results.psv.
    run_dirs = sorted({env.parent for env in input_dir.rglob("environment.yaml")
                       if (env.parent / "results.psv").is_file()})
    if not run_dirs:
        parser.error(f"No benchmark runs (environment.yaml + results.psv) "
                     f"found under {input_dir}")

    # Keep the latest-dated measurement per (datadate, machine, solution,
    # numanode, threadcount); a key's thread counts may be spread over several runs.
    latest = {}
    for run_dir in run_dirs:
        for datadate, machine, solution, numanode, tc, date, payload in process_run(
                run_dir, machines, mappings_path):
            key = (datadate, machine, solution, numanode, tc)
            if key not in latest or date > latest[key][0]:
                latest[key] = (date, payload)

    # The environment.yaml text of each machine's latest run, embedded for the
    # machine hover tooltips of index.html. The "test date" / "test time"
    # lines only order the runs and are dropped from the embedded text.
    machine_envs = {}
    for run_dir in run_dirs:
        text = (run_dir / "environment.yaml").read_text()
        env = yaml.safe_load(text)
        machine = machines[cpu_model_of(env)]
        stamp = (str(env["test date"]), str(env.get("test time", "")))
        text = "".join(line for line in text.splitlines(keepends=True)
                       if not re.match(r"""['"]?test (date|time)['"]?\s*:""", line))
        if machine not in machine_envs or stamp > machine_envs[machine][0]:
            machine_envs[machine] = (stamp, text)

    # Merge the thread counts of each key into a single entry.
    by_key = defaultdict(dict)
    for (datadate, machine, solution, numanode, tc), dated_payload in latest.items():
        by_key[(datadate, machine, solution, numanode)][tc] = dated_payload

    entries = []
    for (datadate, machine, solution, numanode) in sorted(by_key):
        runs = by_key[(datadate, machine, solution, numanode)]
        # A key that measured any thread count did not fail - a run of it was
        # killed, but the numbers of the others stand - so its marker is dropped.
        # Only a key left with nothing but the marker failed.
        if len(runs) > 1:
            runs.pop(FAILED, None)
        failed = list(runs) == [FAILED]
        # The exit status the dashboard reports: the runner's own for a key that
        # produced nothing, 0 for one whose numbers all come from queries that ran.
        exitcode = runs[FAILED][1]["exitcode"] if failed else 0
        # proprietary/engineversion/sortcols/data_size/max_res_mem from the
        # latest-dated measurement of the key
        _, newest = max(runs.values(), key=lambda dated: dated[0])
        entries.append(build_entry(
            solution, {} if failed else {tc: payload for tc, (_, payload) in runs.items()},
            datadate, machine, numanode, newest["proprietary"], newest["engineversion"],
            newest["sortcols"], newest["data_size"], newest["max_res_mem"], exitcode))

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
        fh.write("const machine_environments = {\n")
        for i, machine in enumerate(sorted(machine_envs)):
            prefix = "" if i == 0 else ","
            fh.write(prefix + json.dumps(machine) + ":"
                     + json.dumps(machine_envs[machine][1], ensure_ascii=False) + "\n")
        fh.write("};\n")

    print(f"wrote {args.output_file}: {len(entries)} entr"
          f"{'y' if len(entries) == 1 else 'ies'} from {len(run_dirs)} run(s).")

    if QUERYMETA_PSV.is_file():
        write_querymeta_js()
    else:
        print(f"warning: {QUERYMETA_PSV} not found; "
              f"querymeta.generated.js not refreshed", file=sys.stderr)


if __name__ == "__main__":
    main()
