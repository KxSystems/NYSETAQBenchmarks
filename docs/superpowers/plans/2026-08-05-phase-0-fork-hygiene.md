# Phase 0 — Fork Hygiene and Upstream Fixes: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the fork's inherited defects — a stale submodule pin that breaks the smoke
test, the QuickStart and three of six SIZEs; six DuckDB queries that have never run; an
unpinned DuckDB; and README drift — then merge upstream PR #14, so that Phase 1 has a repo
whose tests actually run.

**Architecture:** Seven independent commits on one branch. Each touches a file shared with
`KxSystems/NYSETAQBenchmarks` and must stand alone as an upstream PR. No new architecture, no
openq-specific code. The submodule bump lands first because until it does, nothing else can
be verified.

**Tech Stack:** bash, q (**never executed here**), Python via `uv`, DuckDB CLI 1.5.5, git
submodules, `gh` CLI.

---

## Operating constraints — read before Task 0

### Clean room

**No kdb+ / KDB-X binary is present on this machine.** A KDB-X Community install previously
sat at `~/q` (binary, `l64.zip`, `q.k`, `kc.lic`); it was deleted on 2026-08-05 with the
human's explicit permission, specifically so that the clean-room claim is structural rather
than a matter of discipline. `q` is not on `PATH` and `QHOME` is unset.

- **Never obtain, install or execute a q / kdb+ / KDB-X binary.** Do not download one, do not
  set `QHOME`, do not run `./test/inmemory.sh` (it shells out to `q` via `generateDB.sh`).
- This is a legal boundary on the openq project, not a preference. A single execution
  contaminates the clean-room claim.
- The `kdb`, `kdbxsql` and `pykx` arms may be **edited** and shape-checked (`bash -n`,
  argument construction, PSV column counts) — never run.
- If any task appears to require running q, that is a **stop-and-report**, never a task to
  engineer around.

### The gate is a clean-room subset, not `test/inmemory.sh`

`test/inmemory.sh` cannot run here: it calls `DATAFORMAT=kdb ./generateDB.sh`, which invokes
`q`, and `queryEngines.sh` defaults to `ENGINES="kdb,kdbxsql,duckdb,chdb,polars,pykx,pandas"`.
Task 0 creates `/tmp/cleanroom-gate.sh`, the parquet-and-Python-only subset, which is the gate
for every later task. Do not commit it — it is scaffolding, and Phase 1 will decide whether
`test/inmemory.sh` grows a clean-room mode.

### Commits

Branch: `fix/phase-0-fork-hygiene` off `main`. One commit per concern, nothing reformatted, no
drive-by cleanups. Every commit message ends with exactly:

```
Co-Authored-By: ryan <ryan@ryan-h.com>
```

No Claude/model co-author, and no model attribution in the PR body.

---

## File structure

| File | Change | Why |
|---|---|---|
| `external/kx/taq` (gitlink) | Modify: `ecf6daa` → `dcfc9c6` | Task 2. Root cause of the broken test, QuickStart and SIZE map |
| `FORK.md` | Create | Task 3. Divergence ledger + upstream PR ledger |
| `artifacts/queries/inmemory/duckdb.psv` | Modify: lines 25–30 | Task 4. `GROUP BY time` → `GROUP BY minute` |
| `pysrc/queryrunner/main.py` | Modify: line 6 | Task 5. Pin DuckDB |
| `pyproject.toml` | Modify: line 12 | Task 5. Mirror the pin |
| `README.md` | Modify: lines 475, 483 | Task 6. `add_nickname`, stale test-data path |
| PR #14 merge | Modify: 16 files | Task 7. Rayforce adapter |
| `/tmp/cleanroom-gate.sh` | Create, **never committed** | Task 0. The gate |

---

## Task 0: Environment prerequisites

**Files:**
- Create: `/tmp/cleanroom-gate.sh` (scaffolding, never committed)

- [ ] **Step 1: Confirm no kdb+ binary is present**

```bash
which q || echo "OK: q not on PATH"
ls ~/q 2>&1 | head -1
echo "QHOME=${QHOME:-unset}"
```

Expected: `OK: q not on PATH`, `No such file or directory` for `~/q`, and `QHOME=unset`. If a
q binary IS present anywhere, **stop and report** — do not proceed, and do not remove it
yourself.

- [ ] **Step 2: Confirm `uv` is available**

```bash
export PATH="$HOME/.local/bin:$PATH"
uv --version
```

Expected: a version string. The human installs `uv` before this plan is launched — if it is
missing, **stop and report**; do not install it yourself. Every later `uv run` needs
`$HOME/.local/bin` on `PATH`.

- [ ] **Step 3: Confirm the DuckDB CLI**

```bash
duckdb --version
```

Expected: `v1.5.5 (Variegata) d8cdaa33fd`. A different version is fine but record it — Task 5
pins to the version the fix is verified against.

- [ ] **Step 4: Create the clean-room gate**

```bash
cat > /tmp/cleanroom-gate.sh <<'GATE'
#!/usr/bin/env bash
# Clean-room subset of test/inmemory.sh: parquet + Python engines only.
# NEVER add the kdb/kdbxsql/pykx arms to this file.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
export PATH="$HOME/.local/bin:$PATH"

TESTPSV=./external/kx/taq/test/data
TESTDB=/tmp/cleanroom-testdb
TESTDBDATE=20260401
RESULTDIR=/tmp/cleanroom-results
IDX_ARG=${1:-}

rm -rf "${TESTDB}" "${RESULTDIR}"
SIZE=full SYMBOLSTOREDAS=ROWGROUP DATAFORMAT=parquet \
  ./generateDB.sh "${TESTPSV}" "${TESTDB}/parquet/rowgroup" "${TESTDBDATE}"

./benchmarks/inmemory/queryEngines.sh \
  --db-dir "${TESTDB}" \
  --param-dir ./artifacts/parameters/test \
  --datadate "${TESTDBDATE}" \
  --threads "4" \
  --engines duckdb \
  --solutions "DuckDB (Index)" \
  --result-dir "${RESULTDIR}" \
  ${IDX_ARG:+--idx "${IDX_ARG}"}

echo "--- status tally ---"
awk -F'|' 'NR>1 && $9 >= 0 {n[$11]++} END {for (s in n) print s, n[s]}' "${RESULTDIR}/results.psv"
GATE
chmod +x /tmp/cleanroom-gate.sh
```

- [ ] **Step 5: Run the gate and record that it fails**

```bash
/tmp/cleanroom-gate.sh 2>&1 | tail -20
```

Expected: **failure**, because `TESTPSV=./external/kx/taq/test/data` does not exist at the
current submodule pin. Something like `No such file or directory`. This is the "red" that
Task 2 turns green. Record the exact output.

---

## Task 1: Fork remotes and archive the oracle branch

**Files:** none (git plumbing only)

- [ ] **Step 1: Confirm the current remote layout**

```bash
git remote -v
git branch -a
```

Expected: `origin` → `peachq-org/NYSETAQBenchmarks`, and only `main` exists remotely.

- [ ] **Step 2: Add the upstream remote**

```bash
git remote add upstream https://github.com/KxSystems/NYSETAQBenchmarks.git
git fetch upstream
git remote -v
```

Expected: `upstream` → `KxSystems/NYSETAQBenchmarks`, fetch succeeds.

- [ ] **Step 3: Pull the oracle-harness branch in from the other clone and push it to the fork**

The branch exists only in a different checkout and has never been pushed anywhere.

```bash
git remote add oracle-src /home/ubuman/dev/rayforce/references/NYSETAQBenchmarks
git fetch oracle-src openq-oracle-harness:openq-oracle-harness
git log --oneline -1 openq-oracle-harness
```

Expected: `2741145 openq: oracle harness comparing openq's q against DuckDB`

```bash
git push origin openq-oracle-harness
git remote remove oracle-src
```

Expected: the branch appears on the fork. It is archival — Phase 1 folds it in and it is not
merged here.

- [ ] **Step 4: Create the working branch**

```bash
git checkout -b fix/phase-0-fork-hygiene main
```

No commit for this task — it changes no tracked file.

---

## Task 2: Bump the submodule gitlink

This is the root-cause fix. It must land before every other task, because until it does the
gate cannot run and no "before" state is meaningful.

**Files:**
- Modify: `external/kx/taq` (gitlink `ecf6daa` → `dcfc9c6`)

- [ ] **Step 1: Demonstrate the failure — the documented SIZEs do not exist at the pin**

```bash
git submodule update --init --recursive
(cd external/kx/taq && source scripts/util.sh && for s in tiny small medium large xlarge full; do printf "%-8s -> " "$s"; get_letters "$s" 2>&1 | head -1; done)
```

Expected, at the current pin:

```
tiny     -> ERROR: Unknown SIZE: 'tiny'. Valid options are: full large medium small
small    -> Z-Z
medium   -> I-I
large    -> A-H
xlarge   -> ERROR: Unknown SIZE: 'xlarge'. Valid options are: full large medium small
full     -> A-Z
```

README's table (lines 71–78) documents `tiny`=Z, `small`=X-Z, `medium`=T-Z, `large`=P-Z,
`xlarge`=I-Z. So `tiny` and `xlarge` are unrunnable and three more are silently wrong. Record
this output — it goes in the upstream PR body.

- [ ] **Step 2: Demonstrate the second failure — the test data path**

```bash
ls external/kx/taq/test/data 2>&1 | head -2
ls external/kx/taq/testdata | head -4
grep -n "TESTPSV\|TESTDBDATE" test/inmemory.sh
```

Expected: `test/data` does not exist; `testdata/` holds `*_20250701.psv`; `test/inmemory.sh`
uses `TESTPSV=./external/kx/taq/test/data` with `TESTDBDATE=20260401`. The script was written
against upstream taq; the gitlink was never bumped.

> **Do not "fix" this by changing `TESTPSV` to `testdata`.** That would point a `20260401` run
> at `20250701` files, build an empty database, and produce a vacuously green smoke test.

- [ ] **Step 3: Bump the gitlink**

```bash
cd external/kx/taq
git fetch origin
git checkout dcfc9c6
cd -
git add external/kx/taq
git submodule status
```

Expected: `+dcfc9c6... external/kx/taq (1.3.2-...)` — a `+` prefix meaning staged-and-changed.

- [ ] **Step 4: Verify the SIZE map now matches README**

```bash
(cd external/kx/taq && source scripts/util.sh && for s in tiny small medium large xlarge full; do printf "%-8s -> " "$s"; get_letters "$s" 2>&1 | head -1; done)
```

Expected:

```
tiny     -> Z-Z
small    -> X-Z
medium   -> T-Z
large    -> P-Z
xlarge   -> I-Z
full     -> A-Z
```

Cross-check against README lines 71–78. `tiny`=`Z-Z` matches the documented `Z`.

- [ ] **Step 5: Verify the test data path and date now resolve**

```bash
ls external/kx/taq/test/data
```

Expected: four PSVs dated `20260401`, matching `TESTDBDATE=20260401` in `test/inmemory.sh`.

- [ ] **Step 6: Verify the shipped test parameters resolve against the new data**

The parameters must name instruments that actually exist, or every parameterised query
returns zero rows and any comparison "passes" while proving nothing.

```bash
head -c 100 artifacts/parameters/test/freqInstr.txt; echo
head -c 100 artifacts/parameters/test/infreqInstr.txt; echo
awk -F'|' 'NR>1{print $3}' external/kx/taq/test/data/SPLITS_US_ALL_BBO_Z_20260401.psv | sort -u | tr '\n' ' '; echo
```

Expected: `freqInstr` = `ZKPU` and `infreqInstr` = `ZOOZ.W`, and the data contains `ZKPU` and
`ZOOZ W` (the space becomes `.` under TAQ suffix conversion). Both resolve. Note this in the
commit body: the brief's §5 claim that the test parameters name absent instruments was true
only of the **stale pin's** 2025-07-01 data, and the bump fixes that too.

- [ ] **Step 7: Run the gate — it should now get further**

```bash
/tmp/cleanroom-gate.sh 2>&1 | tail -25
```

Expected: the parquet database builds and the DuckDB solution runs. The status tally will show
`error 6` (idx 24–29, fixed in Task 4) alongside successes. Record the tally — it is the
"before" number for Task 4.

- [ ] **Step 8: Commit**

```bash
git add external/kx/taq
git commit -m "$(cat <<'EOF'
fix: bump taq submodule to dcfc9c6

The gitlink recorded ecf6daa (1.3.1-6-gecf6daa) while the repo's scripts,
docs and published results were all written against a later taq. At the
recorded pin:

  - get_letters has no 'tiny' and no 'xlarge'; both die with Unknown SIZE.
    README's QuickStart opens with `export SIZE=tiny`, and results for
    xlarge are published.
  - small/medium/large resolve to Z-Z/I-I/A-H against README's documented
    X-Z/T-Z/P-Z -- different data under the same name.
  - test data is testdata/ dated 20250701, while test/inmemory.sh reads
    test/data with TESTDBDATE=20260401, so the smoke test cannot run.
  - artifacts/parameters/test names ZKPU and ZOOZ.W, absent from the 2025
    data and present in the 2026 data, so parameterised queries returned
    nothing.

The README table and the published results are self-consistent with
upstream taq, so this bump is corrective and does not change what the
benchmark measures.

Co-Authored-By: ryan <ryan@ryan-h.com>
EOF
)"
```

---

## Task 3: FORK.md

**Files:**
- Create: `FORK.md`

- [ ] **Step 1: Write the file**

```markdown
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
- **Vendor the taq submodule.** Phase 2. This will be the first divergence that is *not*
  offerable upstream, which is why it is deliberately not bundled with the bump in
  divergence 1.
- **`duckv2`.** A separate DuckDB query set, deliberately out of scope for Phases 0–2. The
  existing `duckdb.psv` queries are not to be improved or tuned in the meantime.
```

- [ ] **Step 2: Commit**

```bash
git add FORK.md
git commit -m "$(cat <<'EOF'
docs: add FORK.md divergence and upstream ledger

Records every divergence from KxSystems/NYSETAQBenchmarks with its
rationale and whether it can be offered upstream, plus a ledger of fixes
actually offered and their outcomes.

Co-Authored-By: ryan <ryan@ryan-h.com>
EOF
)"
```

---

## Task 4: Fix `duckdb.psv` idx 24–29

Six queries have never produced a DuckDB answer. Every DuckDB solution in
`results/inmemory/large/` and `results/inmemory/xlarge/` records `status=error` for all six,
at `engineversion: 1.5.4`, live on the dashboard.

**Files:**
- Modify: `artifacts/queries/inmemory/duckdb.psv:25-30`

- [ ] **Step 1: Reproduce the failure in isolation**

```bash
cat > /tmp/repro.sql <<'EOF'
CREATE TABLE quote AS SELECT CAST(ts AS TIMESTAMP_NS) AS time, sym, ex, bid, ask, bsize, asize
FROM (VALUES ('AAA','N',TIMESTAMP '2026-04-01 09:30:00',1.0,2.0,3,4),
             ('AAA','P',TIMESTAMP '2026-04-01 09:41:00',1.5,2.5,5,6)) v(sym,ex,ts,bid,ask,bsize,asize);
WITH filtered AS (SELECT time_bucket(INTERVAL '10 minutes', time)::TIME AS minute, ex, (bsize * bid + asize * ask) / (bsize + asize) AS liqWMid FROM quote WHERE sym = 'AAA') PIVOT filtered ON ex USING AVG(liqWMid) AS avgLiqWMid GROUP BY time;
EOF
duckdb < /tmp/repro.sql 2>&1 | tail -3
```

Expected:

```
Binder Error: Referenced column "time" not found in FROM clause!
Candidate bindings: "minute"
```

`TIMESTAMP_NS` is the real type — `pysrc/queryrunner/executors/inmemory/duckdb_con.py:92`
rewrites `quote.time` to `make_timestamp_ns(epoch_ns(date)+time)`. `time_bucket` binds fine
against it; only the `GROUP BY` is wrong.

- [ ] **Step 2: Confirm the surviving column must be named `minute`, not `time`**

```bash
awk -F'|' 'NR==1 || ($1>=24 && $1<=29) {print $1"  sortby="$6}' artifacts/queries/inmemory/querymeta.psv
awk -F'|' '$1==24 {print $3}' artifacts/queries/inmemory/kdb.psv
```

Expected: `sortby=minute` for all six, and the q sibling groups `by 10 xbar time.minute`,
producing a column called `minute`. So the fix renames the `GROUP BY`, it does not rename the
alias.

- [ ] **Step 3: Apply the fix — idx 24–27, `GROUP BY time` → `GROUP BY minute`**

Four separate edits in `artifacts/queries/inmemory/duckdb.psv`. Each old string is unique.

| Line | Replace | With |
|---|---|---|
| 25 | `AS avgLiqWMid GROUP BY time\|infreqInstr` | `AS avgLiqWMid GROUP BY minute\|infreqInstr` |
| 26 | `AS avgLiqWMid GROUP BY time\|freqInstr` | `AS avgLiqWMid GROUP BY minute\|freqInstr` |
| 27 | `AS avgLiqWMid GROUP BY time\|fiftyInstrs` | `AS avgLiqWMid GROUP BY minute\|fiftyInstrs` |
| 28 | `AS avgLiqWMid GROUP BY time\|thousandInfreqInstrs` | `AS avgLiqWMid GROUP BY minute\|thousandInfreqInstrs` |

- [ ] **Step 4: Apply the fix — idx 28–29, four more occurrences each**

Line 29, replace:

```
SELECT time, LAST_VALUE(COLUMNS(* EXCLUDE time) IGNORE NULLS) OVER (ORDER BY time ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM (PIVOT filtered ON sym USING AVG(liqWMid) AS avgLiqWMid GROUP BY time) ORDER BY time|fiftyInstrs
```

with:

```
SELECT minute, LAST_VALUE(COLUMNS(* EXCLUDE minute) IGNORE NULLS) OVER (ORDER BY minute ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM (PIVOT filtered ON sym USING AVG(liqWMid) AS avgLiqWMid GROUP BY minute) ORDER BY minute|fiftyInstrs
```

Line 30, the same replacement but ending `|thousandInfreqInstrs` instead of `|fiftyInstrs`.

- [ ] **Step 5: Verify the fix binds and forward-fill still works**

```bash
cat > /tmp/fixed.sql <<'EOF'
CREATE TABLE quote AS SELECT CAST(ts AS TIMESTAMP_NS) AS time, sym, ex, bid, ask, bsize, asize
FROM (VALUES ('AAA','N',TIMESTAMP '2026-04-01 09:30:00',1.0,2.0,3,4),
             ('AAA','P',TIMESTAMP '2026-04-01 09:41:00',1.5,2.5,5,6),
             ('BBB','N',TIMESTAMP '2026-04-01 09:31:00',1.1,2.1,3,4)) v(sym,ex,ts,bid,ask,bsize,asize);
WITH filtered AS (SELECT time_bucket(INTERVAL '10 minutes', time)::TIME AS minute, ex, (bsize * bid + asize * ask) / (bsize + asize) AS liqWMid FROM quote WHERE sym = 'AAA') PIVOT filtered ON ex USING AVG(liqWMid) AS avgLiqWMid GROUP BY minute;
WITH filtered AS (SELECT time_bucket(INTERVAL '10 minutes', time)::TIME AS minute, sym, (bsize * bid + asize * ask) / (bsize + asize) AS liqWMid FROM quote WHERE sym IN ('AAA','BBB')) SELECT minute, LAST_VALUE(COLUMNS(* EXCLUDE minute) IGNORE NULLS) OVER (ORDER BY minute ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM (PIVOT filtered ON sym USING AVG(liqWMid) AS avgLiqWMid GROUP BY minute) ORDER BY minute;
EOF
duckdb < /tmp/fixed.sql 2>&1
```

Expected: two result tables, first column named `minute`, no error. In the second, `BBB` is
carried forward into the `09:40:00` row — that is the `LAST_VALUE ... IGNORE NULLS` forward
fill working.

- [ ] **Step 6: Verify structural integrity of the PSV**

```bash
awk -F'|' 'NF!=4 {print "BAD FIELD COUNT line "NR": "NF}' artifacts/queries/inmemory/duckdb.psv
diff <(cut -d'|' -f1 artifacts/queries/inmemory/duckdb.psv) <(cut -d'|' -f1 artifacts/queries/inmemory/querymeta.psv) && echo "OK: idx aligned with querymeta"
```

Expected: no bad field counts, and `OK: idx aligned with querymeta`.

- [ ] **Step 7: Run the gate on just these six queries**

```bash
/tmp/cleanroom-gate.sh 24-29 2>&1 | tail -15
```

Expected: `success 6` in the tally, where the Task 2 run showed `error 6`. If any row is still
`error`, read `/tmp/cleanroom-results/DuckDB_Index_/os.txt` for the engine's own message.

- [ ] **Step 8: Run the full gate and compare tallies**

```bash
/tmp/cleanroom-gate.sh 2>&1 | tail -10
```

Expected: the same tally as Task 2 step 7 but with 6 fewer `error` and 6 more `success`. Any
other movement is a regression — investigate before committing.

> **Honest limit.** This establishes that the six queries **bind and return rows**. It does
> **not** establish that they match the q sibling's answer: proving that needs either KDB-X
> (forbidden here) or the `qlite` seam from Phase 1, and the openq harness reports that
> `src/pivot.q` does not load under openq either. Equivalence for idx 24–29 stays open, and
> the commit body must say so.

- [ ] **Step 9: Commit**

```bash
git add artifacts/queries/inmemory/duckdb.psv
git commit -m "$(cat <<'EOF'
fix(duckdb): bind idx 24-29 by grouping on the aliased bucket

Each of these six queries aliases the 10-minute bucket as `minute` in the
CTE and then ends `GROUP BY time`, so DuckDB answers:

  Binder Error: Referenced column "time" not found in FROM clause!
  Candidate bindings: "minute"

They have therefore never produced a result: every DuckDB solution in
results/inmemory/large and results/inmemory/xlarge records status=error
for idx 24-29 at engineversion 1.5.4.

`minute` is the correct surviving name -- querymeta.psv records
sortby=minute for all six, and the q sibling's `by 10 xbar time.minute`
produces a column of that name -- so this renames the GROUP BY (and, for
idx 28-29, the SELECT/EXCLUDE/ORDER BY) rather than the alias.
time_bucket is untouched; it binds correctly against the TIMESTAMP_NS
column that duckdb_con.py builds.

Verified to bind and return rows, with forward-fill intact for idx 28-29.
Output equivalence against the q sibling is NOT established here and
remains open.

Co-Authored-By: ryan <ryan@ryan-h.com>
EOF
)"
```

---

## Task 5: Pin DuckDB

`duckdb>=1.4` means a published number cannot be reproduced later. Pin to the version Task 4
was verified against.

**Files:**
- Modify: `pysrc/queryrunner/main.py:6`
- Modify: `pyproject.toml:12`

- [ ] **Step 1: Record the version actually in use**

```bash
export PATH="$HOME/.local/bin:$PATH"
uv run --with duckdb python -c "import duckdb; print(duckdb.__version__)"
```

Expected: `1.5.5`. Use whatever it reports in the two edits below — it must be the version
Task 4's gate run used.

- [ ] **Step 2: Pin in the PEP 723 block (authoritative for `uv run`)**

In `pysrc/queryrunner/main.py` line 6, replace `#   "duckdb>=1.4",` with `#   "duckdb==1.5.5",`.

- [ ] **Step 3: Mirror in `pyproject.toml`**

Line 12, replace `    "duckdb>=1.4",` with `    "duckdb==1.5.5",`.

- [ ] **Step 4: Verify the pin resolves and the gate still passes**

```bash
python -m py_compile pysrc/queryrunner/main.py && echo "OK: compiles"
/tmp/cleanroom-gate.sh 2>&1 | tail -8
```

Expected: `OK: compiles`, and the same tally as Task 4 step 8.

- [ ] **Step 5: Commit**

```bash
git add pysrc/queryrunner/main.py pyproject.toml
git commit -m "$(cat <<'EOF'
fix: pin duckdb exactly

`duckdb>=1.4` lets an unrelated release change published numbers with no
record. The tracked results were produced at engineversion 1.5.4 while a
fresh `uv run` today resolves 1.5.5, so the dashboard already mixes
versions.

Pinned to the version the idx 24-29 fix is verified against, in both the
PEP 723 block (authoritative for `uv run`) and pyproject.toml.

Co-Authored-By: ryan <ryan@ryan-h.com>
EOF
)"
```

---

## Task 6: Fix README drift

**Files:**
- Modify: `README.md:475`, `README.md:483`

- [ ] **Step 1: Confirm both stale references**

```bash
sed -n '475p;483p' README.md
grep -n "add_nickname\|add_solution_name" benchmarks/inmemory/common.sh
```

Expected: line 475 says `add_nickname`; line 483 says `external/kx/taq/test/data/`;
`common.sh` defines `add_solution_name`, with no `add_nickname` anywhere.

- [ ] **Step 2: Fix the function name**

In `README.md` line 475, replace `followed by \`add_nickname\`, and add` with
`followed by \`add_solution_name\`, and add`.

- [ ] **Step 3: Fix the test-data path**

In `README.md` line 483, replace
`[external/kx/taq/test/data/](./external/kx/taq/test/data/). The scripts in the` with
`[external/kx/taq/test/data/](./external/kx/taq/test/data/) (fetch the submodule first). The scripts in the`

Note: the path itself is now **correct** after Task 2 — the bump is what made it true. The
only change here is the submodule reminder, because a fresh clone without `--recursive` finds
an empty directory. Verify before editing:

```bash
ls external/kx/taq/test/data | wc -l
```

Expected: `4`. If it is `0`, Task 2 did not land — stop and fix that first.

- [ ] **Step 4: Verify no other stale references**

```bash
grep -rn "add_nickname" . --include=*.md --include=*.sh | grep -v "^./docs/superpowers" || echo "OK: no add_nickname left"
```

Expected: `OK: no add_nickname left`.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: correct add_nickname reference and note the submodule requirement

README's "Adding a New Python-Based In-Memory Query Engine" step 5 refers
to add_nickname; common.sh has defined add_solution_name since the
solution rename. Step 6 points at the submodule's test data without
saying it must be fetched first, where a fresh clone finds an empty
directory.

Co-Authored-By: ryan <ryan@ryan-h.com>
EOF
)"
```

---

## Task 7: Merge upstream PR #14 (rayforce adapter)

**Files:** 16 files per the PR — `artifacts/queries/inmemory/rayforce.psv`, `src/rayforce/*`
(8 files), `benchmarks/inmemory/queryEngines.sh`, `generateDB.sh`, `src/compareOutput.q`,
`test/inmemory.sh`, `src/resolve_device.sh`, `src/runQueries.q`, `README.md`.

- [ ] **Step 1: Fetch the PR head**

```bash
gh pr view 14 --repo KxSystems/NYSETAQBenchmarks --json state,title --jq '.state + " — " + .title'
git fetch upstream pull/14/head:pr-14
git log --oneline -1 pr-14
```

Expected: `OPEN — feat(inmemory): add Rayforce grouped and parted adapter`, and head
`240964f4b8f66f06e74d7a2f2b493b8fa24eab93` (`chore(bench): merge upstream main`). If the head
SHA differs, KX has updated the PR — record the new SHA and use it everywhere below.

- [ ] **Step 2: Merge it**

```bash
git merge pr-14 --no-ff -m "$(cat <<'EOF'
merge: KxSystems/NYSETAQBenchmarks PR #14 — Rayforce adapter

Merged at PR head 240964f4b8f66f06e74d7a2f2b493b8fa24eab93. Still open
upstream; if KX merges a modified version, re-taking it from the merged
SHA is cheap.

src/rayforce/runRayforce.sh is a third parallel implementation of the
runner contract that src/runQueries.q and pysrc/queryrunner/main.py
already implement. Merged as-is deliberately: rewriting a contributor's
adapter on merge would be hostile, and Phase 2 moves it onto the written
contract instead. Recorded as a follow-up in FORK.md.

Co-Authored-By: ryan <ryan@ryan-h.com>
EOF
)"
```

If there are conflicts, resolve them in favour of **both** changes — Task 2's submodule bump
and Task 6's README edits are in files #14 also touches (`test/inmemory.sh`, `README.md`).
Record every resolution in the PR body.

- [ ] **Step 3: Shape-check everything the merge touched**

```bash
for f in $(git diff --name-only HEAD~1 HEAD | grep '\.sh$'); do bash -n "$f" && echo "OK $f"; done
awk -F'|' 'NF!=4 {print FILENAME" line "NR": "NF" fields"}' artifacts/queries/inmemory/rayforce.psv
diff <(cut -d'|' -f1 artifacts/queries/inmemory/rayforce.psv) <(cut -d'|' -f1 artifacts/queries/inmemory/querymeta.psv) && echo "OK: rayforce.psv idx-aligned"
```

Expected: every `.sh` OK, no bad field counts, `OK: rayforce.psv idx-aligned`.

- [ ] **Step 4: Confirm the merge did not disturb the clean-room arms**

```bash
git diff HEAD~1 HEAD -- src/runQueries.q
```

Expected: the PR's stated `+2/-2` only. `src/runQueries.q` is never executed here, so this is
a **shape check, not a test** — say so in the PR body.

- [ ] **Step 5: Verify the Python path still runs**

```bash
/tmp/cleanroom-gate.sh 2>&1 | tail -8
```

Expected: the same tally as Task 5. The rayforce arm is opt-in (`--engines rayforce`), so a
default run must be unchanged.

- [ ] **Step 6: Commit**

The merge commit from Step 2 is the commit. If conflict resolution required edits, amend:

```bash
git commit --amend --no-edit
```

---

## Task 8: Verify rayforce from the pinned release

The adapter must be proven against a **published release artifact**, not a local working copy.
Local checkouts exist at `/home/ubuman/dev/rayforce` and `/home/ubuman/dev/rayforce-merge`;
both are likely edited and not release-optimised. Do not use them.

**Files:** none committed — this is verification only.

- [ ] **Step 1: Fetch and check the release**

```bash
mkdir -p /tmp/rayforce-rel && cd /tmp/rayforce-rel
curl -sLO https://github.com/RayforceDB/rayforce/releases/download/v2.5.11/rayforce-2.5.11-linux-x86_64.tar.gz
curl -sLO https://github.com/RayforceDB/rayforce/releases/download/v2.5.11/rayforce-2.5.11-linux-x86_64.tar.gz.sha256
sha256sum -c rayforce-2.5.11-linux-x86_64.tar.gz.sha256
```

Expected: `rayforce-2.5.11-linux-x86_64.tar.gz: OK`. The checksum must be
`8f63ca95ae20f86e34296c7e19a570de3ec018046c5e53a9966c8f961bbb8ccd`. **If it does not match,
stop and report** — do not proceed with an unverified binary.

```bash
tar xzf rayforce-2.5.11-linux-x86_64.tar.gz
find /tmp/rayforce-rel -type f -name 'rayforce*' -perm -u+x
cd - >/dev/null
```

- [ ] **Step 2: Attempt the rayforce arm**

PR #14's `generateDB.sh` path builds the rayforce database by exporting from the **kdb**
database, which needs `q`. That is forbidden here.

```bash
grep -n "rayforce" generateDB.sh
grep -n "exportRayCSV\|kdb" src/rayforce/runRayforce.sh | head -20
```

Read what the rayforce path actually requires. **If it requires a kdb database or invokes
`q` at any point, stop** — do not work around it, and do not run `q`. Record in the PR body:
*"rayforce arm not executed: its database generation path depends on the kdb database, which
cannot be produced clean-room. Shape-checked only."*

- [ ] **Step 3: If and only if a q-free path exists, run it**

```bash
export RAYFORCE_BIN=/tmp/rayforce-rel/<path-from-step-1>
bash -n src/rayforce/runRayforce.sh && echo "OK: syntax"
```

Then run the arm per PR #14's documented invocation with `--engines rayforce --idx 40-44`,
and record the tally.

- [ ] **Step 4: Record the outcome in FORK.md**

Append to the "Follow-ups recorded, not yet done" section whichever applies:

```markdown
- **Rayforce arm verification.** Executed from release v2.5.11 (sha256
  `8f63ca…8ccd`), tally recorded in the Phase 0 PR. / Not executed: its database
  generation path depends on the kdb database, which cannot be produced clean-room.
  Shape-checked only.
```

- [ ] **Step 5: Commit**

```bash
git add FORK.md
git commit -m "$(cat <<'EOF'
docs: record rayforce verification status against release v2.5.11

Verified from the published release artifact rather than a local
checkout: local builds are neither reproducible nor above suspicion for a
multi-vendor benchmark.

Co-Authored-By: ryan <ryan@ryan-h.com>
EOF
)"
```

---

## Task 9: Offer the fixes upstream

Four commits are unambiguous bug fixes carrying no fork agenda. Offer each as its own PR.

- [ ] **Step 1: Confirm what is offerable**

```bash
git log --oneline main..HEAD
```

Expected: the seven commits from Tasks 2–8. Offerable: the submodule bump, the duckdb.psv
fix, the DuckDB pin, the README fix. Not offerable: `FORK.md`, the PR #14 merge.

- [ ] **Step 2: Capture the four commit SHAs**

```bash
SHA_SUBMODULE=$(git log --format=%H --grep="bump taq submodule" main..HEAD)
SHA_DUCKQ=$(git log --format=%H --grep="bind idx 24-29" main..HEAD)
SHA_DUCKPIN=$(git log --format=%H --grep="pin duckdb exactly" main..HEAD)
SHA_README=$(git log --format=%H --grep="correct add_nickname" main..HEAD)
for v in "$SHA_SUBMODULE" "$SHA_DUCKQ" "$SHA_DUCKPIN" "$SHA_README"; do
  [[ -n "$v" ]] || { echo "MISSING SHA — stop"; exit 1; }
done
echo "$SHA_SUBMODULE $SHA_DUCKQ $SHA_DUCKPIN $SHA_README"
```

Expected: four distinct SHAs, none empty.

- [ ] **Step 3: Write each PR body from the evidence already recorded**

Each body states the defect, the evidence, and the fix — no mention of the fork, no vendor
content. Write the first:

```bash
cat > /tmp/pr-submodule.md <<'BODY'
## Problem

The `external/kx/taq` gitlink records `ecf6daa` (`1.3.1-6-gecf6daa`), but this repo's
scripts, docs and published results were written against a later `taq`. At the recorded pin:

- `get_letters` has no `tiny` and no `xlarge`; both die with `Unknown SIZE`. README's
  QuickStart opens with `export SIZE=tiny`, and `results/inmemory/xlarge/` is published.
- `small`/`medium`/`large` resolve to `Z-Z`/`I-I`/`A-H`, against README's documented
  `X-Z`/`T-Z`/`P-Z` — different data under the same name.
- Test data is `testdata/` dated `20250701`, while `test/inmemory.sh` reads `test/data`
  with `TESTDBDATE=20260401`, so the smoke test cannot run.
- `artifacts/parameters/test/` names `ZKPU` and `ZOOZ.W`, absent from the 2025 data and
  present in the 2026 data, so parameterised test queries returned nothing.

Reproduce:

```
$ (cd external/kx/taq && source scripts/util.sh && get_letters tiny)
ERROR: Unknown SIZE: 'tiny'. Valid options are: full large medium small
```

## Fix

Bump the gitlink to `dcfc9c6`. The README table and the published results are
self-consistent with upstream `taq`, so this is corrective and does not change what the
benchmark measures.
BODY
```

Write the other three the same way, from the evidence recorded in Tasks 4, 5 and 6:
`/tmp/pr-duckdb-idx.md` (the `Binder Error` output and the `sortby=minute` justification),
`/tmp/pr-duckdb-pin.md` (tracked results at `1.5.4` versus a fresh resolve at `1.5.5`), and
`/tmp/pr-readme.md` (`add_nickname` versus `add_solution_name` in `common.sh`).

- [ ] **Step 4: Open one PR per fix**

Branch names use an `offer/` prefix — do **not** prefix them `upstream/`, which collides
confusingly with the remote of that name.

```bash
open_offer () {
  local branch=$1 sha=$2 title=$3 body=$4
  git checkout -b "${branch}" upstream/main
  git cherry-pick "${sha}"
  git push origin "${branch}"
  gh pr create --repo KxSystems/NYSETAQBenchmarks --base main \
    --head "peachq-org:${branch}" --title "${title}" --body-file "${body}"
  git checkout fix/phase-0-fork-hygiene
}

open_offer offer/fix-submodule-pin  "$SHA_SUBMODULE" "fix: bump taq submodule to dcfc9c6"                  /tmp/pr-submodule.md
open_offer offer/fix-duckdb-idx     "$SHA_DUCKQ"     "fix(duckdb): bind idx 24-29 by grouping on the aliased bucket" /tmp/pr-duckdb-idx.md
open_offer offer/pin-duckdb         "$SHA_DUCKPIN"   "fix: pin duckdb exactly"                              /tmp/pr-duckdb-pin.md
open_offer offer/fix-readme-drift   "$SHA_README"    "docs: correct add_nickname reference"                 /tmp/pr-readme.md
```

If a cherry-pick conflicts, the commit was not standalone — **stop and report** rather than
resolving, because standalone-ness is the property being tested.

- [ ] **Step 5: Record every PR in the FORK.md ledger**

Fill in the ledger table with the date, PR number, what it contains, and `offered` as the
outcome. Outcomes get updated as KX responds.

- [ ] **Step 6: Commit**

```bash
git add FORK.md
git commit -m "$(cat <<'EOF'
docs: record the four fixes offered upstream

Co-Authored-By: ryan <ryan@ryan-h.com>
EOF
)"
```

---

## Final verification

- [ ] **Step 1: Full shape check**

```bash
for f in $(git diff --name-only main..HEAD | grep '\.sh$'); do bash -n "$f" && echo "OK $f"; done
for f in $(git diff --name-only main..HEAD | grep '\.py$'); do python -m py_compile "$f" && echo "OK $f"; done
```

- [ ] **Step 2: Final gate run with the tally**

```bash
/tmp/cleanroom-gate.sh 2>&1 | tail -10
```

Expected: 6 more `success` and 6 fewer `error` than the Task 2 baseline, nothing else moved.

- [ ] **Step 3: Confirm the clean-room claim held**

```bash
which q || echo "OK: q still not on PATH"
ls ~/q 2>&1 | head -1
echo "QHOME=${QHOME:-unset}"
```

Expected: `OK: q still not on PATH`, `~/q` absent, `QHOME=unset`. State plainly in the PR body
that no kdb+ binary was present on the machine at any point during this work, and that `kdb`,
`kdbxsql` and `pykx` were shape-checked and never executed.

- [ ] **Step 4: Open the PR** per `background-it`'s step 8 handoff format, against `main` on
`peachq-org/NYSETAQBenchmarks`.
