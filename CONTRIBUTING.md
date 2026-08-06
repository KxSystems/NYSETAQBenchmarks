# Contributing

This fork exists so that any query engine can enter the benchmark on equal terms. This file
says what that means in practice. [`docs/engine-contract.md`](docs/engine-contract.md) is the
technical half — the command line, the result columns, the timing protocol — and this file is
the social half.

## What gets accepted

The bar is [README](README.md#open-repeatable-comparable)'s, unchanged, because it is a public
promise:

> the shared runner contract still holds (same result columns in the same order, three runs per
> query, the setup rows), the existing engines still produce the results they produced before,
> and your query file stays row-aligned by `idx` with `querymeta.psv`.

That is the whole bar for merging. There is no maintainer taste test and no vendor is
privileged, **including peachq**. If your engine clears it, the PR gets taken.

Clearing the bar is not the same as having a publishable number, and the two are deliberately
separate gates. A query has to return the same answer as the other engines to mean anything,
which is what [`src/compareOutput.q`](src/compareOutput.q) checks against a
`--query-output-dir` run (floats within `FLOATDIFFTHREASHOLD`). An engine that cannot express
a query, or gets it wrong, is **still merged**: the failure is recorded as data in its
`status` column and shown, not quietly dropped. What is not acceptable is a number that looks
right and isn't — an engine that degrades a query it cannot answer into a cheaper one it can
must fail loudly instead.

A conformance checker that automates this is planned and does not exist yet. Until it does,
the check is the comparator plus the query-status tally in your PR body.

## What a vendor may and may not tune

You own **your query file** (`artifacts/queries/inmemory/<engine>.psv`) and **your adapter**
— the executor class or runner your engine is driven by.

You do not touch:

- **another engine's queries**, for any reason, including making them fairer;
- **the shared parameters** (`artifacts/parameters/<SIZE>/*.txt`) or `querymeta.psv`, beyond
  keeping your file row-aligned by `idx`;
- **the timing protocol** — three runs per query, the setup rows, what `run3memKB` and
  `ressizeKB` are measured from. A change there stops every engine's results being comparable
  with every other engine's and with the results already published.

If you believe a shared file is wrong, open it as its own PR with the evidence, separately
from your engine.

## How results get published

A result nobody else can reproduce is an advertisement, not a measurement. To go on the
dashboard a run needs:

- **A pinned release artifact.** The engine is fetched by version and sha256 from a published
  release, never a local build. `src/qengine/qbin.sh` is the pattern.
- **Recorded hardware.** Every run ships an `environment.yaml` describing the host, and the
  CPU model must be mapped in [`results/mappings.yaml`](results/mappings.yaml).
- **The `environment.yaml` attached** to the run directory, alongside each solution's
  `stats.yaml` and `os.txt`.

Timings are only comparable against others from the same machine. Development machines —
laptops, workstations, anything thermally or memory constrained next to a server part — are
listed under `dev_machines` in `results/mappings.yaml`, and `pysrc/convertToJSFormat.py` drops
their runs from the generated dashboard data unless it is asked for them with
`--include-dev-machines`. Those runs prove the pipeline works. They are never published as
results. `FORK.md` records why.

## The clean room

**The maintainer of this fork never runs a kdb+ or KDB-X binary**, and never obtains one to
verify an expected value. The `kdb`, `kdbxsql` and `pykx` arms are maintained and
shape-checked here — `bash -n`, argument construction, PSV column counts — but they are not
executed, and DuckDB running the row-aligned SQL sibling is the oracle for a q result.

This binds the maintainer, not you. **If you hold a KX licence you are welcome to submit
kdb-run results**, and they are as publishable as anyone else's. Every PR states which arms
were executed and which were only shape-checked, so nobody has to guess.

Note that the prohibition is on KX's proprietary binary, not on any executable named `q`.

## Disclosure

The maintainer of this fork also develops **peachq**, one of the engines benchmarked here (as
the `qlite` arm). peachq's `NOTICE` records it as a fork of the **rayforce** array engine by
Anton Kundenko, and rayforce's author wrote upstream
[KxSystems/NYSETAQBenchmarks#14](https://github.com/KxSystems/NYSETAQBenchmarks/pull/14), the
Rayforce adapter, which this fork merged while it was still open upstream. So two of the
engines in the suite share a lineage, and one of them is the maintainer's.

That is exactly why the bar above is written down rather than exercised case by case, why
peachq is pinned to a published release like everything else, and why its failing queries are
published as failures. If you think the venue is tilted, say so in an issue — that is a bug in
the fork's stated purpose, not a difference of opinion.
