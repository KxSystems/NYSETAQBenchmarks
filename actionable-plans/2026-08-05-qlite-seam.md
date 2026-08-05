# The qlite seam — running the unmodified `kdb.psv` under a second q implementation

**Date:** 2026-08-05 · **Status:** Stage A ratified, not yet built · **Spec:**
`docs/superpowers/specs/2026-08-05-taq-benchmark-fork-design.md` (Phase 1)

Written as a file rather than a PR body because it is a two-stage programme: Stage B is
blocked on engine changes in a different repo and must survive across sessions.

## Problem

No `qlite` arm exists; `--engines qlite` is a no-op, so no q implementation other than KDB-X
can enter the benchmark. `FORK.md`'s follow-ups all depend on a written engine contract, and
writing one honestly requires a second consumer of it.

The prior art on branch `openq-oracle-harness` (`2741145`) built a parallel 49-line runner
that emits only `idx|status|run2timeNS|run3timeNS`, not the contract PSV, and hard-codes
`20250701` test-data filenames that the Phase 0 submodule bump has made stale. Folding it in
rather than extending it is the point.

## Viability — probed at both layers against peachq v0.71.0

Release artifact `peachq-v0.71.0-linux-x86_64.tar.gz`, sha256
`b61c58d26e89ae01179f5b269c5de82c887803d0f1fa4084ca8583ab37821339`.

| needs | driver surface | shared plumbing | verdict |
|---|---|---|---|
| the arm | absent | `run_solution` already appends `-result`/`-tableStatsDir`/`-queryOutputDir` | wire an arm |
| the runner | `src/runQueries.q:1` exits: `5.0>.z.K`, peachq reports `0.71` | all 466 lines of contract machinery are present | **3 — adapt, do not fork** |
| kdb database | `src/taqToKDB.q:31` `([parseToDisk]): use ` + backtick + `kx.taq.taq` → `error: nyi` | peachq reads and writes kdb binary natively | **write a plain-q converter** |

> **Modules are not required, and an earlier draft of this plan said they were.** peachq will
> not implement the KDB-X module system, which looked like it closed the kdb data path. It
> does not. Verified against v0.71.0: peachq writes genuine kdb binary format (`ff01` magic on
> a flat file, `fe20` vector header on a splayed column), resolves `.Q.en` enumeration, and
> reads both back correctly. The format was never the blocker. The blocker is only that
> `src/taqToKDB.q` and `external/kx/taq/taq/init.q` are *written* in KDB-X-5.0-only q.
>
> **Correction: splayed only, not partitioned.** An earlier draft claimed date-partitioned
> support on the strength of a `set` into a directory *named* like a date partition. That is
> not partitioning — no `par.txt`, no `\l` partitioned view was ever loaded, and peachq does
> not currently do partitioned databases. The claim was wrong.
>
> **It also does not matter here, because this benchmark is in-memory.** The suite runs with
> `-storage_backend memory` over a single `DATADATE`; `runQueries.q` loads tables into RAM and
> only then starts timing, and the in-memory `results.psv` IO columns are ~0 by design. The
> on-disk layout has one job — get three tables into memory once — so **splayed is sufficient
> and partitioning is irrelevant to what is measured.** The converter writes splayed tables
> for the single benchmark date.
>
> `taq/init.q` cannot be patched around: typed lambda params (`{[fileName:` backtick `s; …]}`,
> used at lines 28, 40, 44, 54, 60, 67, 81, 106, 117, 133, 142) are a parse error under
> peachq. So the path is a fresh plain-q PSV→kdb converter owned by this fork, using neither
> modules nor typed params.

**Present in 0.71:** `.Q.opt`, `.Q.dd`, `.Q.gc`, `.Q.ts`, `.z.K/.z.k/.z.f/.z.x/.z.p/.z.o`,
`hopen`, `read0`, `hsym`, `0:`, multi-line string continuation, correct three-argument `if`
semantics (both branches execute), and it loads `src/util.q`, `src/pivot.q`,
`src/memusage.q` and `src/getQueryParameters.q`.

> `src/pivot.q` **does** load. The 2026-08-05 fork brief states it does not; that was true of
> an older openq build, not of this release. Any plan quoting that claim is out of date.

**Absent in 0.71:** the KDB-X module `use` form; typed lambda params; `.log.info` (29 calls)
and `.log.error` (6 calls), from the KDB-X logging module; `.mem.objsize` (2 calls), from the
DI module; `` `s# `` applied to a dictionary (`error: type`); `src/loadHiveDataset.q`
(`nyi parse error`); and the `C` type char.

### The `C` type char is the load-path constraint

`("JCF"; enlist "|") 0: file` fails, as does `"C"$"x"`. `S` and `*` both work. This matters
more than it sounds: TAQ's schemas are full of char columns — the quote schema alone is
`"NCSEIEICICCCCCCCCCCNNCC"` — and `ex`, `cond` and `corr` are touched by **33 of the 84
queries** (`ex` by 32 of them, including the idx 24–29 pivots).

There is a plain-q workaround, verified: read the column as `*` and convert with
`first each`, which yields a genuine char column (`type` → `10h`), with char comparison
(`"x"="x"` → `1b`) and `exnames`-style dictionary lookup on a char key both working. The
loader pays a conversion pass at load time; the resulting types match.

So this does **not** block Stage A. It is, however, a far smaller and more reasonable ask of
peachq than the module system was: supporting `C` in `0:` and in `$` would delete the
workaround entirely.

### A peachq defect found while probing

```q
if[1b; -1 "X"]; exit 0    / prints nothing
-1 "X"; exit 0            / prints "X"
```

Output produced inside an `if` body is discarded when the process exits. This is why
`runQueries.q` appears to stop silently: it reaches the `-help` / missing-mandatory branch,
exits, and the diagnostic is thrown away. It affects diagnostics only — no result data — but
it made the shared runner look structurally broken when it is not, and would have justified a
needless rewrite. **Decision: filed upstream at peachq immediately; Stage A works around it by
keeping diagnostics out of `if` bodies that exit, and does not wait on the fix.**

## Development build, 2026-08-05 — three gaps already closed

Probed against an unreleased build (copied from a working tree; `.z.K` still reports `0.71`).
This is what `QBIN`'s override path is for, and it changes Stage A's shape:

| gap | release 0.71 | dev build |
|---|---|---|
| `C` in `0:` and `$` ([#24](https://github.com/peachq-org/peachq/issues/24)) | fails | **works** |
| output before `exit` ([#23](https://github.com/peachq-org/peachq/issues/23)) | lost | **prints** |
| full TAQ quote schema `"NCSEIEICICCCCCCCCCCNNCC"` | fails | **loads, 1502 rows** |
| `` `s# `` on a dictionary | `error: type` | still fails |
| typed lambda params | parse error | still fails |
| module `use` form | `nyi` | still `nyi` (by design, will not be implemented) |

**The decisive result: `src/runQueries.q` runs under the dev build with only the three-line
shim.** Usage output, `.Q.opt` argument parsing and mandatory-parameter validation all behave:

```
$ q probeD.q -db x
Missing mandatory parameter(s): paramdir, queryfile, querymeta, storage_backend
Run with -help for usage.
```

That settles verdict 3 empirically rather than by inference. `src/qengine/runQueries.lite.q`,
which the Phase 1 spec called for, is **not needed and should not be written**. The `first each`
char workaround is also unnecessary against this build, though Stage A should keep it behind a
capability check while the release still needs it.

## Constraints

- **Clean room.** No kdb+/KDB-X binary, at any point. DuckDB executing the row-aligned SQL
  sibling remains the oracle. Note the prohibition is on KX's proprietary binary, not on any
  executable named `q` — peachq ships one and running it is the entire point.
- **D5 holds:** the unmodified `artifacts/queries/inmemory/kdb.psv`. Failures are data.
- **D4 holds:** `QBIN` defaults to the pinned release. A local or in-development build is an
  explicit override, never the default and never a silent fallback. The checkout at
  `/home/ubuman/dev/openq/q` is dated Jul 2 and lacks `.z.K` entirely — five weeks *behind*
  the release, so "local build" must not be assumed to mean "newer".
- **Upstream files touched:** `benchmarks/inmemory/queryEngines.sh` (new arm),
  `test/inmemory.sh` (coverage), `src/runQueries.q` (the version guard). Relaxing the guard
  from "KDB-X ≥ 5.0" to a capability check is offerable to KX as a standalone commit; the
  rest is fork-only.
- **Out of scope:** `duckv2`, the rayforce retrofit, the conformance checker,
  `CONTRIBUTING.md`, and anything AWS.

## Alternatives → chosen → what it rules out

Ready-to-paste `FORK.md` rows:

| # | Divergence | Why | Offerable upstream? |
|---|---|---|---|
| 7 | `qlite` engine arm, `QBIN`-selected | Lets any q implementation run the benchmark; upstream has no path for one | Yes, in principle |
| 8 | `src/runQueries.q` version guard relaxed to a capability check | `5.0>.z.K` rejects every non-KDB-X q, including ones that can run the corpus | Yes, standalone |
| 9 | Capability shim for `.log.*` / `.mem.objsize` | Both come from KDB-X modules unavailable to other implementations | Yes, in principle |

- **Chosen: adapt `src/runQueries.q` behind a capability shim.** Rules out a fourth parallel
  runner. The repo already carries three implementations of one contract, and the openq
  harness became the fourth precisely because nobody probed the plumbing layer.
- **Rejected: a fresh `src/qengine/runQueries.lite.q`** (which the Phase 1 spec originally
  named). Justified only if the shared runner genuinely could not run; the evidence says its
  apparent failure was a peachq diagnostics bug, not a structural one. If Stage A's first
  task disproves that, this decision reverts and the lite runner is correct after all.
- **Rejected: generating the kdb database under peachq.** Needs the module `use` form it
  cannot parse. Deferred to Stage B rather than worked around.

## Staging

**Stage A — unblocked, build now.** The `qlite` arm, the capability shim, a PSV loader, and
`docs/engine-contract.md`. Data loads from PSVs, as `openq/taq.q` does.

> **Consequence, to be disclosed not buried:** qlite's setup rows (`idx` 0/-1/-2/-3) measure
> PSV parsing, not a kdb database load, so they are **not** comparable with KDB-X's. Decision:
> emit them as normal and record the caveat in `stats.yaml` and `FORK.md`. Query rows
> (`idx` 1–84) are comparable, since the data is in memory either way.

**Stage B — splayed kdb parity, and no longer blocked on peachq.** A plain-q PSV→splayed
converter owned by this fork (no modules, no typed params, no partitioning), writing the three
tables for the single benchmark date. That restores setup-row comparability, because both arms
then load a kdb-format database rather than one parsing PSVs, and it gives `QBIN` a data path
with no KDB-X anywhere. Sized at roughly 60–80 lines: `openq/taq.q` does the typed read in 28,
and the write is `.Q.en` plus a `set` per table, both verified.

The one thing to settle in Stage B is how `runQueries.q`'s `loadKDBDBIntoMemory` — which walks
a *partitioned* database — is pointed at a splayed one. That is a loader branch, not a rewrite,
and it is the reason Stage B is a separate PR rather than folded into Stage A.

**Still genuinely blocked on peachq**, and each is now small and specific:

| blocked on | unblocks | workaround today | filed |
|---|---|---|---|
| `C` in `0:` and `$` | clean typed loads (33 of 84 queries touch char cols) | read `*`, then `first each` | [#24](https://github.com/peachq-org/peachq/issues/24) |
| `` `s# `` on a dictionary | idx 62 and 63 | none — must fail loudly | not yet |
| partitioned databases | nothing in this benchmark | n/a — in-memory suite, splayed suffices | n/a |
| whatever `src/loadHiveDataset.q` needs | the parquet backend | none needed; PSV/kdb paths cover it | n/a |

Note the module system is **not** on this list. peachq will not implement it, and after the
findings above it does not need to.

## Success measures

- **Tallies.** peachq success/error/empty out of 84, none → after. DuckDB must remain at
  `success 85` (84 queries plus the load setup row), unmoved. A tally that does not move where
  predicted is a finding to explain, not a non-event.
- **Falsifying row: idx 62 and 63.** The only two queries using `timeBucketsStep`, which needs
  `` `s# `` on a dictionary — and peachq 0.71 answers `error: type`. If the implementation
  lets the step lookup degrade to exact match, both return plausible-but-wrong answers instead
  of failing, and the harness is lying rather than reporting. They must fail loudly or be
  right. This is the one test that separates a green-but-wrong build from a correct one.
- **Blast radius.** Only `qlite` rows appear. No existing engine's status changes.
  `results/mappings.yaml` needs no entry (it maps CPU model → machine, not solution).
  `convertToJSFormat.py` keys by `(datadate, machine, solution)`, so a new solution surfaces
  without further wiring.

## What we would ask peachq for

Not the module system, and not partitioned databases. Two small, specific capabilities:

1. **`C` as a type char in `0:` and `$`** — filed as
   [peachq-org/peachq#24](https://github.com/peachq-org/peachq/issues/24). Deletes the
   load-path workaround for the 33 queries touching `ex`/`cond`/`corr` and removes a
   conversion pass from every load.
2. **`` `s# `` on a dictionary.** Recovers idx 62 and 63, the only two queries using
   `timeBucketsStep`. Not yet filed — worth confirming against the in-dev branch first, since
   it may already be fixed there.

Filed already: [peachq-org/peachq#23](https://github.com/peachq-org/peachq/issues/23), output
inside an `if` body lost on exit. Diagnostics only, but it is what made `src/runQueries.q`
look structurally incompatible when it is not, and it repeatedly confounded this
investigation — several probes read as silent failures until they were re-run over piped
stdin instead of a script ending in `exit`.
