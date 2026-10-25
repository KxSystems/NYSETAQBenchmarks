#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "black==25.1.0",
#   "pyyaml",
#   "sqlparse==0.5.3",
# ]
# ///
"""Convert NYSE TAQ benchmark results into the dashboard's data.json.

The input directory (e.g. ``results/inmemory/full``) is scanned recursively
for benchmark runs; a run is any directory that contains both:

  * results.psv           - the query/engine timing results (pipe separated)
  * environment.yaml      - machine / test-run environment

alongside per-solution ``<solution>/stats.yaml`` and ``<solution>/os.txt``. The
run's "test date" is taken from environment.yaml; directory names carry no
meaning.

Measurements are keyed by the (datadate, machine, solution, numanode) tuple. A
key's thread counts may be split across several run directories (e.g. one per
thread count); they are merged into a single run of the output. When the same
thread count of a key appears in several runs, only the one with the latest
"test date" is kept; engine_version, data_size_mb and peak_memory_kb come from
the latest-dated thread count of the key.

The NUMA node is part of the key rather than just a reported field: a run pinned
to one node with ``numactl`` and an unpinned one see different core counts and
memory bandwidth, so their thread counts must not be merged as if they were one
scaling curve.

A solution whose runner the operating system killed - running out of memory on a
data size that does not fit is the usual cause - never gets to run a query:
``run_solution`` swallows the exit status, so at most its load rows reach
results.psv. Both runners write the solution-level part of
``<solution>/stats.yaml`` before they load any data, so such a run is identified
by its stats.yaml (labelled with the solution name by ``add_solution_name``) next
to a non-zero "Exit status" in its ``<solution>/os.txt``. It is reported with
that ``exit_code`` and no thread counts. Its load rows are dropped: they time a
load that never finished.

Query texts are stored once per solution, keyed by query idx, and are
pretty-printed for display: SQL with sqlparse, Python with black and q with a
small rule-based formatter. Formatting only ever changes whitespace (and, for
Python, adds trailing commas); a formatted text that differs from the original
in anything else is discarded in favour of the original.

The output format is described in pysrc/dataJSONSchema.md.
"""

import argparse
import json
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import black
import sqlparse
import yaml

SCHEMA_VERSION = 1

QUERY_DIR = Path(__file__).resolve().parent.parent / "artifacts" / "queries" / "inmemory"
QUERYMETA_PSV = QUERY_DIR / "querymeta.psv"
TAGS_PSV = QUERY_DIR / "tags.psv"

# Value reported for a run that was not pinned to a NUMA node (empty NUMANODE),
# i.e. one free to use all of them. Kept out of the numeric node names on purpose.
NUMANODE_UNPINNED = "all"

# Stands in for the thread count of a failed solution, which has none: its runner
# was killed before it reported a single measurement.
FAILED = None

# Load phases are written to results.psv with idx <= 0, in pipeline order.
LOAD_PHASES = {0: "load", -1: "transform", -2: "sort", -3: "index"}

# Statuses of query rows that were deliberately not run in this invocation
# (--idx / --tags / --instrument); they say nothing about the solution.
FILTERED_STATUSES = {"idxfiltered", "tagfiltered", "instrumentfiltered"}

# results.psv "engine" column -> language of its query texts
ENGINE_LANGUAGES = {
    "q-sql": "q",
    "SQL": "sql",
    "duckdb_con": "sql",
    "chdb": "sql",
    "chdb_pyarrow": "sql",
    "pandas": "python",
    "polars": "python",
    "pykx": "python",
}

# Texts no longer than this are kept on a single line.
LINE_WIDTH = 80


# --------------------------------------------------------------------------
# Query formatting


def _same_text(original: str, formatted: str, language: str):
    """Whether formatting changed nothing but whitespace (and Python trailing commas)."""
    def squash(text):
        text = re.sub(r"\s+", "", text)
        if language == "python":
            text = re.sub(r",([)\]}])", r"\1", text)
        return text
    return squash(original) == squash(formatted)


def _format_sql(text: str):
    """sqlparse's layout, with the one-item-per-line lists it makes packed back up to LINE_WIDTH."""
    lines = []
    for line in sqlparse.format(text, reindent=True, indent_width=2).splitlines():
        if lines and lines[-1].endswith(",") and len(lines[-1]) + 1 + len(line.strip()) <= LINE_WIDTH:
            lines[-1] += " " + line.strip()
        else:
            lines.append(line.rstrip())
    return "\n".join(lines)


def _format_python(text: str):
    mode = black.Mode(line_length=LINE_WIDTH, string_normalization=False)
    return black.format_str(text, mode=mode)


def _q_top_level_breaks(text: str):
    """Positions of top-level ' from ', ' where ' and ' by ' in a q expression.

    Only positions outside brackets and strings count, so sub-selects stay on
    the line of the clause that holds them, and a ' from ' right after a bare
    select / exec / update / delete keyword stays on that keyword's line.
    """
    breaks = []
    depth = 0
    in_string = False
    i = 0
    while i < len(text):
        ch = text[i]
        if in_string:
            if ch == "\\":
                i += 1
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif depth == 0 and ch == " ":
            match = re.match(r" (from|where|by) ", text[i:])
            bare_keyword = re.search(r"(^|[\s(,])(select|exec|update|delete)$", text[:i])
            if match and not (match.group(1) == "from" and bare_keyword):
                breaks.append(i)
        i += 1
    return breaks


def _q_matching_paren(text: str):
    """Index of the bracket closing the one that opens ``text``; -1 when it is not closed."""
    depth = 0
    in_string = False
    for i, ch in enumerate(text):
        if in_string:
            in_string = ch != '"' or text[i - 1] == "\\"
        elif ch == '"':
            in_string = True
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _q_depth0(text: str):
    """(index, char) of every character of ``text`` outside brackets and strings."""
    depth = 0
    in_string = False
    for i, ch in enumerate(text):
        if in_string:
            in_string = ch != '"' or text[i - 1] == "\\"
        elif ch == '"':
            in_string = True
        elif ch in "([{":
            if depth == 0:
                yield i, ch
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif depth == 0:
            yield i, ch


def _q_split(text: str, sep: str):
    """``text`` split at its top-level ``sep`` characters.

    A comma followed by an adverb or ':' (,' ,/ ,\\ ,:) is the join operator, not a
    list separator, so it is not split at.
    """
    parts = []
    start = 0
    for i, ch in _q_depth0(text):
        if ch == sep and not (sep == "," and text[i + 1:i + 2] in ("'", "/", "\\", ":")):
            parts.append(text[start:i])
            start = i + 1
    parts.append(text[start:])
    return [part.strip() for part in parts]


def _q_pack(parts, sep: str, indent: str):
    """Join ``parts`` with ``sep`` into lines of up to LINE_WIDTH, continuations indented."""
    lines = [parts[0]]
    for part in parts[1:]:
        lines[-1] += sep
        if len(lines[-1]) + 1 + len(part) <= LINE_WIDTH:
            lines[-1] += " " + part
        else:
            lines.append(indent + part)
    return lines


def _q_segment_lines(segment: str):
    """The lines of one clause of a q expression (no top-level by / from / where in it)."""
    if len(segment) <= LINE_WIDTH:
        return [segment]

    # A clause opening with a long parenthesised query or lambda, e.g. the first
    # operand of a join: lay the query out inside its brackets.
    close = _q_matching_paren(segment) if segment[0] in "({" else -1
    inner = (_q_lines(segment[1:close])
             if close > 0 and len(_q_split(segment[1:close], ";")) == 1 else [])
    if len(inner) > 1:
        rest = segment[close + 1:].strip()
        lines = [segment[0] + inner[0]] + [" " + line for line in inner[1:]]
        if rest.startswith(","):
            lines[-1] += segment[close] + ","
            if rest[1:].strip():
                lines.extend(_q_lines(rest[1:].strip()))
        else:
            lines[-1] += segment[close] + (" " + rest if rest else "")
        return lines

    # A function call or lambda with ;-separated arguments / statements: one per
    # line, aligned after the opening bracket.
    for i, ch in _q_depth0(segment):
        if ch not in "[{":
            continue
        close = i + _q_matching_paren(segment[i:])
        parts = _q_split(segment[i + 1:close], ";") if close > i else []
        if len(parts) < 2 or close - i < LINE_WIDTH // 2:
            continue
        head = segment[:i + 1]
        indent = " " * len(head) if len(head) <= 24 else "  "
        lines = []
        for n, part in enumerate(parts):
            sub = _q_lines(part) if part else [""]
            if n == 0:
                lines.append(head + sub[0])
            else:
                lines.append(indent + sub[0])
            lines.extend(indent + line for line in sub[1:])
            lines[-1] += ";" if n < len(parts) - 1 else segment[close]
        rest = segment[close + 1:]
        if rest.strip():
            if len(lines[-1]) + len(rest) <= LINE_WIDTH:
                lines[-1] += rest
            else:
                lines.extend(_q_lines(rest.strip()))
        return lines

    # A long list - select columns, where constraints: wrap at its commas.
    parts = _q_split(segment, ",")
    if len(parts) > 1:
        keyword = re.search(r"\b(select|exec|update|delete|by|where|from)\s+", segment)
        aligned = keyword and keyword.end() < len(parts[0])
        return _q_pack(parts, ",", " " * keyword.end() if aligned else "  ")
    return [segment]


def _q_lines(text: str):
    """The lines of a q expression with its top-level by / from / where clauses on their own."""
    text = text.strip()
    if len(text) <= LINE_WIDTH:
        return [text]
    segments = []
    start = 0
    for pos in _q_top_level_breaks(text):
        segments.append(text[start:pos].strip())
        start = pos + 1
    segments.append(text[start:].strip())
    lines = []
    for k, segment in enumerate(segments):
        pad = "" if k == 0 else "  "
        lines.extend(pad + line for line in _q_segment_lines(segment))
    return lines


def _format_q(text: str):
    return "\n".join(_q_lines(text))


FORMATTERS = {"sql": _format_sql, "python": _format_python, "q": _format_q}


def format_query(text: str, language: str, warn):
    """The display form of a query text; the text itself when it is short or unformattable."""
    text = text.strip()
    formatter = FORMATTERS.get(language)
    if formatter is None or len(text) <= LINE_WIDTH:
        return text
    try:
        formatted = formatter(text).strip()
    except Exception as exc:  # the formatters reject what they cannot parse
        warn(f"could not format {language} query, kept as is ({type(exc).__name__}): {text[:60]}")
        return text
    if not _same_text(text, formatted, language):
        warn(f"formatting changed more than whitespace, kept as is: {text[:60]}")
        return text
    return formatted


# --------------------------------------------------------------------------
# Reading run directories


def parse_stats(stats_path: Path):
    """Return (proprietary, engineversion, sortcols, data_size_mb) from a solution's stats.yaml.

    The file comes in two shapes: a nested mapping (one key per table) and a
    flat concatenation of table documents. Both keep ``proprietary`` (and,
    since they were added, ``engineversion`` and ``sortcols``) as top-level
    scalars and repeat ``size (MB):`` once per table, so these fields are read
    directly with regexes rather than fully parsing (a plain YAML load would
    collapse the flat form's duplicate keys and lose sizes).
    """
    text = stats_path.read_text()

    def scalar(pattern):
        match = re.search(pattern, text, re.MULTILINE)
        return (match.group(1).strip().strip("'\"") or None) if match else None

    proprietary = scalar(r"^\s*proprietary\s*:\s*(.+?)\s*$")
    engineversion = scalar(r"^\s*engineversion\s*:\s*(.+?)\s*$")
    sortcols = scalar(r"^sortcols\s*:\s*(.+?)\s*$")

    total = None
    for raw in re.findall(r"size \(MB\)\s*:\s*(\S+)", text):
        try:
            value = float(raw)
        except ValueError:  # null, ~ and the like
            continue
        total = value if total is None else total + value
    if total is not None and total == int(total):
        total = int(total)

    return proprietary, engineversion, sortcols, total


def parse_exit_status(os_txt_path: Path):
    """The exit status of a solution's runner, from the ``/usr/bin/time -v`` output.

    ``time -v`` reports it as "Exit status: <n>" after whatever the process
    itself wrote to stderr, hence matching anywhere in the file. None when the
    file or the line is missing. run_solution overwrites os.txt per thread
    count, so this is the status of the last thread count the solution ran.
    """
    if not os_txt_path.is_file():
        return None
    match = re.search(r"^\s*Exit status:\s*(\d+)\s*$", os_txt_path.read_text(), re.MULTILINE)
    return int(match.group(1)) if match else None


def parse_max_res_mem(os_txt_path: Path):
    """"Maximum resident set size (kbytes)" from a solution's os.txt; None when missing."""
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
    value = (env.get("envvars") or {}).get("NUMANODE")
    return NUMANODE_UNPINNED if value is None else (str(value).strip() or NUMANODE_UNPINNED)


def cpu_model_of(env: dict):
    """The cpu model of a loaded environment.yaml; some runs capitalize the key."""
    cpu = env["system"]["cpu"]
    return cpu.get("model", cpu.get("Model"))


def iso_date(value: str):
    """ISO-format an 8-digit date (20260401 -> 2026-04-01); leave any other format untouched."""
    return f"{value[:4]}-{value[4:6]}-{value[6:8]}" if re.fullmatch(r"\d{8}", value) else value


def to_int(value: str):
    """Parse a nanosecond timing cell; blank cells become None."""
    value = (value or "").strip()
    return int(value) if value else None


def unquote(field: str):
    """Undo the CSV-style quoting of results.psv cells that contain quotes."""
    if len(field) >= 2 and field.startswith('"') and field.endswith('"'):
        return field[1:-1].replace('""', '"')
    return field


def load_psv(psv_path: Path):
    """Group results.psv rows by (solution, threadcount).

    Returns {(solution, threadcount) -> {"engine": str, "load": [rows], "query": [rows]}}
    and the solutions in the order first seen in the file.
    """
    grouped = defaultdict(lambda: {"engine": None, "load": [], "query": []})
    solutions = []
    with psv_path.open(newline="") as fh:
        header = fh.readline().rstrip("\n").split("|")
        col = {name: i for i, name in enumerate(header)}
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            fields = line.split("|")
            solution = fields[col["solution"]]
            group = grouped[(solution, int(fields[col["threadcount"]]))]
            row = {
                "idx": int(fields[col["idx"]]),
                "text": unquote(fields[col["query"]]),
                "status": fields[col["status"]],
                "times": [to_int(fields[col[f"run{i}timeNS"]]) for i in (1, 2, 3)],
            }
            group["load" if row["idx"] <= 0 else "query"].append(row)
            group["engine"] = fields[col["engine"]] or group["engine"]
            if solution not in solutions:
                solutions.append(solution)
    return grouped, solutions


def process_run(run_dir: Path, machines: dict, mappings_path: Path):
    """Extract per-(solution, thread count) measurements from one run directory.

    Yields (datadate, machine, solution, numanode, threadcount, date, payload)
    tuples, where payload holds the load/query rows for that thread count plus
    the solution's stats. A solution whose runner was killed is yielded once
    with the FAILED thread count and no rows.
    """
    env = yaml.safe_load((run_dir / "environment.yaml").read_text())
    date = str(env["test date"])
    numanode = numanode_of(env)
    datadate = iso_date(str(env["parameters"]["datadate"]))
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
    # cannot be turned back into a solution name.
    stats_dirs = {}
    for path in sorted(run_dir.iterdir()):
        if not path.is_dir():
            continue
        stats = path / "stats.yaml"
        if not stats.is_file():
            # Both runners write stats.yaml before loading, so this only happens
            # for a run made before they did.
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

    # Thread counts that reached the query phase. A runner killed while loading
    # can still have written its load rows, and those time a load that never
    # finished, so only these thread counts are reported.
    measured = {(sol, tc) for (sol, tc), rows in grouped.items() if rows["query"]}

    for solution in solutions:
        stats_dir = stats_dirs.get(solution)
        if stats_dir is None:
            stats = (None, None, None, None)
            max_res_mem = None
            print(f"warning: no stats.yaml directory found for solution "
                  f"{solution!r} in {run_dir}; its stats are set to null", file=sys.stderr)
        else:
            stats = parse_stats(stats_dir / "stats.yaml")
            max_res_mem = parse_max_res_mem(stats_dir / "os.txt")
        proprietary, engineversion, sortcols, data_size = stats
        for tc in sorted(tc for (sol, tc) in measured if sol == solution):
            yield datadate, machine, solution, numanode, tc, date, dict(
                grouped[(solution, tc)], proprietary=proprietary,
                engineversion=engineversion, sortcols=sortcols,
                data_size=data_size, max_res_mem=max_res_mem, exitcode=0)

    # Solutions that failed before they ran a single query. Their stats.yaml names
    # them and holds the fields written before the load.
    for solution, stats_dir in stats_dirs.items():
        if any(sol == solution for (sol, _) in measured):
            continue
        exitcode = parse_exit_status(stats_dir / "os.txt")
        if not exitcode:
            print(f"warning: solution {solution!r} in {run_dir} ran no query yet its "
                  f"runner reported exit status {exitcode}; skipped", file=sys.stderr)
            continue
        proprietary, engineversion, sortcols, _ = parse_stats(stats_dir / "stats.yaml")
        engine = next((rows["engine"] for (sol, _), rows in grouped.items()
                       if sol == solution and rows["engine"]), None)
        yield datadate, machine, solution, numanode, FAILED, date, {
            "engine": engine, "load": [], "query": [],
            "proprietary": proprietary, "engineversion": engineversion,
            "sortcols": sortcols, "data_size": None, "max_res_mem": None,
            "exitcode": exitcode,
        }


# --------------------------------------------------------------------------
# Building the output


def read_psv_table(path: Path):
    """Rows of a small pipe-separated metadata file as dicts."""
    lines = [line for line in path.read_text().splitlines() if line.strip()]
    header = lines[0].split("|")
    return [dict(zip(header, line.split("|"))) for line in lines[1:]]


def build_queries():
    """The engine-independent query list, from querymeta.psv."""
    queries = []
    for row in read_psv_table(QUERYMETA_PSV):
        query = {
            "idx": int(row["idx"]),
            "description": row["description"].strip(),
            "tags": [tag for tag in row["tags"].split(",") if tag],
            "instrument": row["instrument"].strip(),
            "complexity": row["complexity"].strip(),
        }
        if (row.get("comment") or "").strip():
            query["comment"] = row["comment"].strip()
        queries.append(query)
    return queries


def build_tags():
    """tag -> description, from tags.psv."""
    if not TAGS_PSV.is_file():
        return {}
    return {row["tag"]: row["description"].strip() for row in read_psv_table(TAGS_PSV)}


def build_threads(payload: dict):
    """One thread count of a run: its load phase times and query results."""
    load_ns = {}
    for row in sorted(payload["load"], key=lambda r: -r["idx"]):
        load_ns[LOAD_PHASES.get(row["idx"], f"phase{row['idx']}")] = row["times"][0]
    query_ns = {}
    query_status = {}
    for row in sorted(payload["query"], key=lambda r: r["idx"]):
        if row["status"] == "success":
            query_ns[str(row["idx"])] = row["times"]
        elif row["status"] not in FILTERED_STATUSES:
            query_status[str(row["idx"])] = row["status"]
    threads = {"load_ns": load_ns, "query_ns": query_ns}
    if query_status:
        threads["query_status"] = query_status
    return threads


def latest_known(dated_values, what, warn):
    """The latest-dated non-null value; warns when the non-null values disagree."""
    known = [(date, value) for date, value in dated_values if value is not None]
    if not known:
        return None
    distinct = {json.dumps(value) for _, value in known}
    if len(distinct) > 1:
        warn(f"{what} differs between runs ({', '.join(sorted(distinct))}); using the latest")
    return max(known, key=lambda dv: dv[0])[1]


def build_solutions(latest: dict, warn):
    """Solution-level fields and query texts, from every kept measurement of each solution."""
    fields = defaultdict(lambda: defaultdict(list))
    texts = defaultdict(lambda: defaultdict(list))
    for (_, _, solution, _, _), (date, payload) in latest.items():
        f = fields[solution]
        f["engine"].append((date, payload["engine"]))
        f["open_source"].append((date, None if payload["proprietary"] is None
                                 else payload["proprietary"] == "no"))
        f["sort_columns"].append((date, payload["sortcols"].split(",")
                                  if payload["sortcols"] else None))
        for row in payload["query"]:
            if row["text"].strip():
                texts[solution][str(row["idx"])].append((date, row["text"].strip()))

    solutions = {}
    for solution in sorted(fields):
        f = fields[solution]
        engine = latest_known(f["engine"], f"{solution}: engine", warn)
        language = ENGINE_LANGUAGES.get(engine)
        if engine is not None and language is None:
            warn(f"{solution}: no language known for engine {engine!r}; its queries are not formatted")
        query_text = {}
        for idx in sorted(texts[solution], key=int):
            text = latest_known(texts[solution][idx], f"{solution}: query {idx} text", warn)
            query_text[idx] = format_query(text, language, warn)
        solutions[solution] = {
            "engine": engine,
            "language": language,
            "open_source": latest_known(f["open_source"], f"{solution}: open_source", warn),
            "sort_columns": latest_known(f["sort_columns"], f"{solution}: sort_columns", warn),
            "query_text": query_text,
        }
    return solutions


def build_machines(run_dirs, machines: dict):
    """machine name -> the system section of that machine's latest environment.yaml."""
    latest = {}
    for run_dir in run_dirs:
        env = yaml.safe_load((run_dir / "environment.yaml").read_text())
        machine = machines[cpu_model_of(env)]
        stamp = (str(env["test date"]), str(env.get("test time", "")))
        if machine not in latest or stamp > latest[machine][0]:
            latest[machine] = (stamp, env)
    return {
        machine: {
            "cpu_model": cpu_model_of(env),
            "test_date": stamp[0],
            "environment": env["system"],
        }
        for machine, (stamp, env) in sorted(latest.items())
    }


def build_runs(latest: dict):
    """One run per (datadate, machine, solution, numanode), with its thread counts merged."""
    by_key = defaultdict(dict)
    for (datadate, machine, solution, numanode, tc), dated_payload in latest.items():
        by_key[(datadate, machine, solution, numanode)][tc] = dated_payload

    runs = []
    for key in sorted(by_key, key=lambda k: tuple(str(part) for part in k)):
        datadate, machine, solution, numanode = key
        measurements = by_key[key]
        # A key that measured any thread count did not fail - a run of it was
        # killed, but the numbers of the others stand - so its marker is dropped.
        if len(measurements) > 1:
            measurements.pop(FAILED, None)
        date, newest = max(measurements.values(), key=lambda dated: dated[0])
        failed = list(measurements) == [FAILED]
        runs.append({
            "solution": solution,
            "machine": machine,
            "datadate": datadate,
            "numa_node": numanode,
            "test_date": date,
            "engine_version": newest["engineversion"],
            "exit_code": newest["exitcode"] if failed else 0,
            "data_size_mb": newest["data_size"],
            "peak_memory_kb": newest["max_res_mem"],
            "threads": {} if failed else {
                str(tc): build_threads(payload)
                for tc, (_, payload) in sorted(measurements.items())
            },
        })
    return runs


def dump(document: dict):
    """JSON indented for readable diffs, with the innermost number arrays kept on one line."""
    text = json.dumps(document, indent=1, ensure_ascii=False)
    return re.sub(r"\[\s+((?:-?[\d.eE+]+|null)(?:,\s+(?:-?[\d.eE+]+|null))*)\s+\]",
                  lambda m: "[" + re.sub(r",\s+", ",", m.group(1)) + "]", text) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input_dir", type=Path,
                        help="Benchmark results directory to scan recursively "
                             "(e.g. results/inmemory/full)")
    parser.add_argument("output_file", type=Path, help="Path of the .json file to write")
    parser.add_argument("--size", help="Data size reported in the file "
                                       "(default: the name of input_dir)")
    parser.add_argument("--mappings", type=Path, default=Path("./results/mappings.yaml"),
                        help="Path to mappings.yaml (default: %(default)s)")
    args = parser.parse_args()

    input_dir = args.input_dir.resolve()
    if not input_dir.is_dir():
        parser.error(f"Input directory does not exist: {input_dir}")
    if not args.mappings.is_file():
        parser.error(f"mappings.yaml not found: {args.mappings}")
    machines = yaml.safe_load(args.mappings.read_text()).get("machines", {})

    run_dirs = sorted({env.parent for env in input_dir.rglob("environment.yaml")
                       if (env.parent / "results.psv").is_file()})
    if not run_dirs:
        parser.error(f"No benchmark runs (environment.yaml + results.psv) found under {input_dir}")

    def warn(message):
        print(f"warning: {message}", file=sys.stderr)

    # Keep the latest-dated measurement per (datadate, machine, solution,
    # numanode, threadcount); a key's thread counts may be spread over several runs.
    latest = {}
    for run_dir in run_dirs:
        for datadate, machine, solution, numanode, tc, date, payload in process_run(
                run_dir, machines, args.mappings):
            key = (datadate, machine, solution, numanode, tc)
            if key not in latest or date > latest[key][0]:
                latest[key] = (date, payload)

    document = {
        "schema_version": SCHEMA_VERSION,
        "size": args.size or input_dir.name,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "load_phases": list(LOAD_PHASES.values()),
        "tags": build_tags(),
        "queries": build_queries(),
        "solutions": build_solutions(latest, warn),
        "machines": build_machines(run_dirs, machines),
        "runs": build_runs(latest),
    }
    args.output_file.write_text(dump(document))
    print(f"wrote {args.output_file}: {len(document['runs'])} run(s) of "
          f"{len(document['solutions'])} solution(s) from {len(run_dirs)} run director"
          f"{'y' if len(run_dirs) == 1 else 'ies'}.")


if __name__ == "__main__":
    main()
