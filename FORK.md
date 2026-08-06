# FORK.md

This repository is a community fork of
[KxSystems/NYSETAQBenchmarks](https://github.com/KxSystems/NYSETAQBenchmarks), forked at
`a316c8b`. Upstream remains the origin of the benchmark's design and of the dashboard at
benchmark.kx.com.

`main` is the fork line; upstream is merged in periodically via the `upstream` remote.
Every divergence is listed below with whether it is offerable back to KX.

## Why this fork exists

The upstream suite has one documented path for outside engines ("add a Python executor
class") and one external vendor PR in its history. This fork makes the same suite a venue
any engine can enter on equal terms, against a written contract, while staying close enough
to upstream that results remain comparable.

No vendor is privileged here, including peachq.

## Divergences from upstream

| # | Divergence | Why | Offerable upstream? |
|---|---|---|---|
| 1 | taq submodule at `dcfc9c6`, not `ecf6daa` | The recorded pin breaks the smoke test, the QuickStart and three of six SIZEs | Yes, offered (see ledger) |
| 2 | `duckdb.psv` idx 24–29 `GROUP BY minute` | The queries never bound; six of 84 have no DuckDB answer in published results | Yes, offered (see ledger) |
| 3 | DuckDB pinned exactly | `duckdb>=1.4` makes published numbers irreproducible | Yes, offered (see ledger) |
| 4 | README `add_solution_name` + test-data path | Stale references | Yes, offered (see ledger) |
| 5 | PR #14 (rayforce adapter) merged | Upstream PR still open; the fork does not gate vendors on KX's review queue | N/A, it is upstream's own PR |
| 6 | `duckdb_con.py` inlines parameters for `pivot`-tagged queries | DuckDB rejects bound parameters in a data-driven `PIVOT` source; without this, divergence 2 fixes nothing observable | Yes, folded into the same offer (see ledger) |
| 7 | `qlite` engine arm, `QBIN`-selected | Lets any q implementation run the benchmark; upstream has no path for one | Yes, in principle |
| 8 | `src/runQueries.q` version guard relaxed to a capability check | `5.0>.z.K` rejects every non-KDB-X q, including ones that can run the corpus | Yes, standalone |
| 9 | Capability shim for `.log.*` / `.mem.objsize` — landed as `src/qengine/runQueries.lite.q`, not as a shim | Both come from KDB-X modules unavailable to other implementations. A shim turned out not to be enough: `src/runQueries.q` uses KDB-X typed lambda parameters and progressive blocks inside a conditional, which a second implementation cannot **parse**, so no amount of predefining names helps. See "Follow-ups" | No — it is a fork-owned file, meant to be deleted |
| 10 | `runQueries.lite.q` renders an unmeasured cell as the empty string rather than through `string` | peachq's `string 0Nj` is `"0Nl"` where kdb+'s is `""`, so every qlite `results.psv` carried `0Nl` in the null timing and IO columns and `convertToJSFormat.py` died parsing it | No — a fork-owned file, working around a second implementation's formatting |
| 11 | `results/mappings.yaml` names development machines and `convertToJSFormat.py` drops their runs unless `--include-dev-machines` is passed | The only host this fork has is a laptop. Without a mapping entry no dashboard data can be generated at all; with a bare one, laptop timings can land on the same chart as an EPYC's | Yes, in principle — see below |

### Development-machine results are not published

The one machine this fork can run on is a `12th Gen Intel(R) Core(TM) i7-12700H` laptop.
`convertToJSFormat.py` hard-errors on a CPU model missing from `results/mappings.yaml`, so
until it was added, **no dashboard data could be generated here at all** and every result
existed only as a PSV. The other two entries are server parts, and README promises publicly
that timings are "comparable: same hardware, or the numbers mean nothing".

Adding the laptop next to them silently would have broken that promise, so the entry comes
with both halves of the guard:

- **A name that states the class.** `DEV_INTEL_CORE_I7_12700H`, so the hardware page's machine
  selector reads as a dev box at a glance rather than as a third server.
- **An enforced rule.** `mappings.yaml` gained a `dev_machines:` list; `convertToJSFormat.py`
  drops those runs, names each directory it dropped, and **exits non-zero if that left nothing
  to write** rather than emitting an empty data file that looks like a successful publish.
  `--include-dev-machines` is the deliberate opt-in that makes the pipeline runnable here.

Rejected: a documented convention alone. Publishing already needs an explicit `git add -f`
(`results/` is gitignored), and a rule that only lives in prose fails exactly when someone is
in a hurry — which is when it matters. Also rejected: filtering by a `DEV_` name prefix, which
makes a publication decision turn on string matching; the list is data and says what it means.

The mechanism is fork-specific policy rather than a bug fix, so it is offerable upstream only
as a feature. Upstream has the same exposure the moment anyone benchmarks on a workstation.

## Upstream ledger

Every fix offered to `KxSystems/NYSETAQBenchmarks`, and what happened.

| Offered | PR | What | Outcome |
|---|---|---|---|
| 2026-08-05 | [KxSystems#15](https://github.com/KxSystems/NYSETAQBenchmarks/pull/15) | Bump the `taq` submodule gitlink `ecf6daa` → `dcfc9c6` (divergence 1) | **merged** `ce8cc8e`, 2026-08-06 |
| 2026-08-05 | [KxSystems#16](https://github.com/KxSystems/NYSETAQBenchmarks/pull/16) | `duckdb.psv` idx 24–29: group on the aliased `minute` bucket, plus parameter inlining (divergence 2, 6) | **part-applied** as `9e40b75`; second commit declined |
| 2026-08-05 | [KxSystems#17](https://github.com/KxSystems/NYSETAQBenchmarks/pull/17) | Pin `duckdb` exactly in the PEP 723 block and `pyproject.toml` (divergence 3) | **declined**, with rationale |
| 2026-08-05 | [KxSystems#18](https://github.com/KxSystems/NYSETAQBenchmarks/pull/18) | README: `add_nickname` → `add_solution_name`, and the submodule note (divergence 4) | **merged** `345d42a`, 2026-08-06 |

### What the responses tell us

Three of four offers were taken in whole or in substance, within a day, from an outside
contributor. **Upstream accepts bug fixes readily**, and the fork's working assumption should
be that a defect found here is worth offering rather than hoarding. Whether upstream would
accept a *vendor engine* is a separate and still-untested question — PR #14, the Rayforce
adapter, has been open since 2026-08-02.

Two declines, both reasoned, both now recorded as deliberate divergences rather than
oversights:

- **#16, second commit** (parameter inlining for `pivot`-tagged queries): *"I consider the
  second commit to be a workaround to a DuckDB bug. DuckDB engineers are aware of this pivot,
  parsing issue."* Correct on the merits — it is a workaround. The fork keeps it because
  divergence 6 is what actually makes idx 24–29 return rows, and waiting on a DuckDB release
  means six queries stay dark. Upstream now has the `GROUP BY` fix without the inlining, so
  **upstream's idx 24–29 still error**; ours do not. Revisit when DuckDB fixes the underlying
  parser issue, and drop divergence 6 at that point.
- **#17** (pinning DuckDB): *"We intentionally don't pin versions in the inline script
  metadata… Results are published across a range of library versions, which users can look up
  in the `stats.yaml` files or via the hover tooltip at benchmark.kx.com."* A legitimate
  design choice for a suite publishing a moving picture of engine progress. This fork pins
  because **repeatable** is one of its three stated goals and an unpinned dependency makes a
  published number unreproducible. Divergence 3 is therefore permanent and deliberate, not a
  fix awaiting acceptance.

## Follow-ups recorded, not yet done

- **Delete `src/qengine/runQueries.lite.q`.** It exists only because `src/runQueries.q` cannot
  be *parsed* by a q implementation lacking three KDB-X syntactic features. Neither is
  reachable by a capability shim, and rewriting them in a shared file would be a fork of it
  rather than a divergence from it. Status against peachq:

  | feature | sites | 0.71 | 0.74 |
  |---|---|---|---|
  | progressive blocks in a conditional, `$[c;[a;b];…]` | 6 | parse error | **fixed** |
  | typed lambda params, `{[x:`C] …}` | 15 | parse error | parse error |
  | parameter destructuring, `{[(a;b)] …}` | 1 (`writeRes`, also typed) | parse error | parse error |

  Two of the three remain, so the lite runner stays for now. The `qlite` arm moves back onto
  `src/runQueries.q` as soon as an implementation parses all three; divergence 8 (the relaxed
  guard) is the prerequisite and is already in place. Until then the repo carries a third
  implementation of `docs/engine-contract.md` — exactly what the contract was written to stop —
  and the lite runner is documented as delete-only, not extend.
- **`qlite` setup rows are not comparable with the kdb+ arms'.** The arm reads PSV files, so
  its `idx 0` row measures PSV parsing, not a kdb+ database load, and it reports `rowCount`s
  that a `check_table_stats` run will compare against the kdb+ arms'. Query rows (`idx` 1–84)
  are comparable, since the data is in memory either way. Stage B replaces the PSV load with a
  plain-q PSV→splayed converter to restore it.
- **`qlite` reports `threadcount` 1 for every run.** peachq's `system "s"` is `0`, so the arm
  runs once for the first `--threads` value rather than once per value, which would emit
  duplicate `threadcount 1` rows and double the query list `convertToJSFormat.py` builds.

- **Rayforce onto the engine contract.** PR #14 was merged as-is at head
  `240964f4b8f66f06e74d7a2f2b493b8fa24eab93`; its `src/rayforce/runRayforce.sh` is a third
  parallel implementation of the runner contract. Phase 2 moves it onto
  `docs/engine-contract.md` as that contract's second consumer. Two specific deviations are
  already visible and must be settled by that move, not before it:
  - `src/rayforce/runQueries.rfl`'s `runq` executes each query **four** times: `run1`,
    `run2`, `run3`, then a fourth `measure` pass under `.mem.ts` that `run3memKB`,
    `ressizeKB` and the `queryoutput_<idx>.csv` are all taken from. Both existing runners
    execute three times and take memory, result size and output from the third. The three
    reported timings are still the first three runs, but `run3memKB` is not measured on run 3
    and the per-query workload is 4 executions rather than 3.
  - `src/compareOutput.q`, which PR #14 also rewrites, reads each CSV header with
    `first read0 (file; 0; 65536)`. That is the byte-range form of `read0`, which yields a
    character vector, so `first` selects a single character rather than the header line,
    where the code it replaces used `first system "head -n 1 …"`. Every other `read0` in this
    repo uses the line-oriented form. Flagged rather than fixed: confirming it, and any fix,
    requires executing KDB-X, which this fork's maintainer does not do (see `CONTRIBUTING.md`).
    It is also feedback to send to upstream PR #14 while it is open.
- **Rayforce arm verification.** Not executed; shape-checked only (`bash -n` over
  `src/rayforce/*.sh`, and `artifacts/queries/inmemory/rayforce.psv` confirmed 4-field and
  idx-aligned with `querymeta.psv`). Two independent blockers, both to be cleared in Phase 2:
  1. Its database generation path is not clean-room. `generateDB.sh`'s `rayforce` branch
     requires the sibling `kdb` database to exist and then runs
     `q ./src/rayforce/exportRayCSV.q` to bridge it to CSV, so producing a Rayforce DB needs
     a kdb+ binary.
  2. The pinned release artifact does not run on the development host. Release v2.5.11
     (`rayforce-2.5.11-linux-x86_64.tar.gz`, sha256 `8f63ca…8ccd`) was fetched and its
     checksum verified, but the binary requires `GLIBC_2.38` and the host provides 2.35.
     Phase 2's `scripts/fetch-engines.sh` therefore needs a glibc floor recorded per engine,
     or a container.
- **Vendor the taq submodule.** Phase 2. This will be the first divergence that is *not*
  offerable upstream, which is why it is deliberately not bundled with the bump in
  divergence 1.
- **`duckdb.psv` idx 24–29: resolved, with a disclosed mechanism difference.** Divergence 2
  fixed the unbindable `GROUP BY time`, which was masking a second, independent defect:
  DuckDB refuses a bound parameter in the source of a `PIVOT` whose pivot values are
  extracted from the data, on every version tested from 1.2.2 to 1.5.5. Isolated on 1.5.5:
  a bound parameter alone binds, a `PIVOT` with a literal binds, the combination does not.

  Divergence 6 resolves it by inlining the parameter as a SQL literal for queries tagged
  `pivot`, leaving the other 78 on bound parameters. **This is a real mechanism difference
  and is disclosed rather than hidden:** those six are executed as literal SQL while the rest
  are prepared. It is defensible because the q sibling has no bound parameters at all.
  `src/getQueryParameters.q` defines `freqInstr`, `fiftyInstrs` and friends as globals that
  `kdb.psv` references by name, so literal substitution is *closer* to what the q side does,
  not further from it. Enumerating the `ON` values was rejected as the alternative: for idx
  24–25 it would hard-code the exchange list the q sibling derives from the data, and for idx
  26–29 the pivot values *are* the parameter list.

  Result: all 84 queries return `status=success` for DuckDB for the first time. Output
  equivalence against the q sibling remains unestablished for these six and needs Phase 1's
  `qlite` seam.
- **`duckv2`.** A separate DuckDB query set, deliberately out of scope for Phases 0–2. The
  existing `duckdb.psv` queries are not to be improved or tuned in the meantime.
