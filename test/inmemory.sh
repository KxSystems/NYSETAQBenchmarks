#!/usr/bin/env bash
#
# Smoke test for the in-memory benchmark suite. Generates a small kdb+ and
# Parquet database from the TAQ submodule's test PSV files, then runs both
# in-memory benchmark scripts against it. Set RAYFORCE_SMOKE=1 to generate the
# date-specific Rayforce DB and include the opt-in Rayforce engine as well.

set -euo pipefail

# All the tools below (./generateDB.sh, ./benchmarks/..., ./external, ./artifacts)
# are invoked relative to the repo root, so run from there regardless of how the
# script was launched.
script_dir=$(dirname "${BASH_SOURCE[0]}")
pushd "${script_dir}/.."

TESTDB=${script_dir}/testdb
TESTDBDATE=20260401

# Test PSV files are available in the TAQ submodule directory.
TESTPSV=./external/kx/taq/test/data
RESULTDIR=${script_dir}/results/inmemory

# Remove the generated database and results on exit, even if a benchmark fails.
trap 'rm -rf "${TESTDB}" "${RESULTDIR}"' EXIT

# Every arm but qlite needs a KDB-X binary to build its database. Say so and
# skip; a silent pass here would hide that nothing was exercised.
if ! command -v q > /dev/null; then
    echo "SKIP: no 'q' on PATH. test/inmemory.sh builds its kdb+ database with" >&2
    echo "      KDB-X, so every arm except qlite needs one. Run the qlite arm on" >&2
    echo "      its own with:" >&2
    echo "        ./benchmarks/inmemory/queryEngines.sh --db-dir DIR --param-dir ... \\" >&2
    echo "          --datadate ... --engines qlite --solutions qlite" >&2
    echo "      where DIR/psv holds the TAQ PSV files (see ${TESTPSV})." >&2
    exit 77
fi

# Generate the test database.
#
# SIZE=full (letters A-Z) is deliberate: the test data only ships BBO_Y and
# BBO_Z files, and the test parameter files reference Y instruments (e.g. YXT,
# YHGJ), so a smaller SIZE (e.g. small = Z-Z) would omit data those queries need.
rm -rf "${TESTDB}/kdb"
rm -rf "${TESTDB}/parquet/rowgroup"

SIZE=full DATAFORMAT=kdb ./generateDB.sh "${TESTPSV}" "${TESTDB}/kdb" "${TESTDBDATE}"
SIZE=full SYMBOLSTOREDAS=ROWGROUP DATAFORMAT=parquet ./generateDB.sh "${TESTPSV}" "${TESTDB}/parquet/rowgroup" "${TESTDBDATE}"

# The qlite arm reads the PSV files themselves, from the same --db-dir layout
# the generated databases live in.
mkdir -p "${TESTDB}/psv"
cp "${TESTPSV}"/*.psv "${TESTDB}/psv/"

# Generate the current query-parameter contract from this exact database. This
# avoids stale checked-in smoke fixtures when parameter names/query coverage
# evolve and guarantees the selected symbols exist in the test data.
PARAM_DIR=${TESTDB}/params
rm -rf "${PARAM_DIR}"
mkdir -p "${PARAM_DIR}"
q ./artifacts/parameters/genParameters.q -db "${TESTDB}/kdb" -dst "${PARAM_DIR}" -q

# What the smoke test covers, stated here rather than inherited from
# queryEngines.sh's defaults, because it has to name the opt-in qlite arm --
# the only arm that needs no KDB-X binary, and so the one that must not be
# quietly dropped. Adding an engine to the suite means adding it here too.
SMOKE_ENGINES="kdb,kdbxsql,duckdb,chdb,polars,pykx,pandas,qlite"
SMOKE_SOLUTIONS="KDB-X,DuckDB (Index),Polars,Pandas,qlite"

if [[ "${RAYFORCE_SMOKE:-0}" == "1" ]]; then
    RAYFORCE_BIN="${RAYFORCE_BIN:-$(cd .. && pwd)/rayforce/rayforce}"
    [[ -x "${RAYFORCE_BIN}" ]] || {
        echo "RAYFORCE_SMOKE=1 but Rayforce binary was not found: ${RAYFORCE_BIN}" >&2
        exit 1
    }
    rm -rf "${TESTDB}/rayforce"
    SIZE=full DATAFORMAT=rayforce RAYFORCE_BIN="${RAYFORCE_BIN}" \
        ./generateDB.sh "${TESTPSV}" "${TESTDB}/rayforce" "${TESTDBDATE}"
    export RAYFORCE_BIN
    SMOKE_ENGINES="${SMOKE_ENGINES},rayforce"
    SMOKE_SOLUTIONS="${SMOKE_SOLUTIONS},Rayforce,Rayforce Parted"
fi
QUERY_ENGINE_ARGS=(--engines "${SMOKE_ENGINES}" --solutions "${SMOKE_SOLUTIONS}")

# Run the benchmarks.
rm -rf "${RESULTDIR}"

./benchmarks/inmemory/queryEngines.sh --db-dir "${TESTDB}" --param-dir "${PARAM_DIR}" --datadate "${TESTDBDATE}" --threads "4 16" --result-dir "${RESULTDIR}" "${QUERY_ENGINE_ARGS[@]}"
./benchmarks/inmemory/kdbAttributes.sh --db-dir "${TESTDB}" --param-dir "${PARAM_DIR}" --datadate "${TESTDBDATE}" --threads "4 16" --result-dir "${RESULTDIR}"

# --include-dev-machines because this asserts that the pipeline runs, which is
# exactly the case the flag exists for; without it the last step fails on any
# host listed under mappings.yaml 'dev_machines'.
python3 ./pysrc/convertToJSFormat.py --include-dev-machines "${RESULTDIR}" "${RESULTDIR}/data.generated.js"

popd
