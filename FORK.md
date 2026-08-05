# FORK.md

This repository is a community fork of
[KxSystems/NYSETAQBenchmarks](https://github.com/KxSystems/NYSETAQBenchmarks), forked at
`a316c8b`. Upstream remains the origin of the benchmark's design and of the dashboard at
benchmark.kx.com.

`main` is the fork line; upstream is merged in periodically via the `upstream` remote.
Every divergence is listed below with whether it is offerable back to KX.

## Why this fork exists

The upstream suite has one documented path for outside engines — "add a Python executor
class" — and one external vendor PR in its history. This fork makes the same suite a venue
any engine can enter on equal terms, against a written contract, while staying close enough
to upstream that results remain comparable.

No vendor is privileged here, including peachq.

## Divergences from upstream

| # | Divergence | Why | Offerable upstream? |
|---|---|---|---|
| 1 | taq submodule at `dcfc9c6`, not `ecf6daa` | The recorded pin breaks the smoke test, the QuickStart and three of six SIZEs | Yes — offered, see ledger |
| 2 | `duckdb.psv` idx 24–29 `GROUP BY minute` | The queries never bound; six of 84 have no DuckDB answer in published results | Yes — offered, see ledger |
| 3 | DuckDB pinned exactly | `duckdb>=1.4` makes published numbers irreproducible | Yes — offered, see ledger |
| 4 | README `add_solution_name` + test-data path | Stale references | Yes — offered, see ledger |
| 5 | PR #14 (rayforce adapter) merged | Upstream PR still open; the fork does not gate vendors on KX's review queue | N/A — it is upstream's own PR |

## Upstream ledger

Every fix offered to `KxSystems/NYSETAQBenchmarks`, and what happened.

| Offered | PR | What | Outcome |
|---|---|---|---|
| _(filled in by Task 9)_ | | | |

## Follow-ups recorded, not yet done

- **Rayforce onto the engine contract.** PR #14 was merged as-is at head
  `240964f4b8f66f06e74d7a2f2b493b8fa24eab93`; its `src/rayforce/runRayforce.sh` is a third
  parallel implementation of the runner contract. Phase 2 moves it onto
  `docs/engine-contract.md` as that contract's second consumer.
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
- **`duckdb.psv` idx 24–29 still fail.** Divergence 2 fixes the unbindable `GROUP BY time`,
  which was masking a second, independent defect: DuckDB refuses a bound parameter in the
  source of a `PIVOT` whose pivot values are extracted from the data
  (`Parser Error: PIVOT statements with pivot elements extracted from the data cannot have
  parameters in their source`), on every version tested from 1.2.2 to 1.5.5. The six queries
  therefore still report `status=error`. Enumerating the `ON` values is not a rename — for
  idx 24–25 it would hard-code the exchange list the q sibling derives from the data, and for
  idx 26–29 the pivot values *are* the parameter list, which DuckDB will not accept in list
  form — so it is out of scope under the minimal-binding-fix rule and belongs with `duckv2`.
- **`duckv2`.** A separate DuckDB query set, deliberately out of scope for Phases 0–2. The
  existing `duckdb.psv` queries are not to be improved or tuned in the meantime.
