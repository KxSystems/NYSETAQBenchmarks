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
TESTDBDATE=20250701

# Test PSV files are available in the TAQ submodule directory.
TESTPSV=./external/kx/taq/testdata
RESULTDIR=${script_dir}/results/inmemory

# Remove the generated database and results on exit, even if a benchmark fails.
trap 'rm -rf "${TESTDB}" "${RESULTDIR}"' EXIT

# Generate the test database.
#
# SIZE=full (letters A-Z) is deliberate: the test data only ships BBO_Y and
# BBO_Z files, and the test parameter files reference Y instruments (e.g. YXT,
# YHGJ), so a smaller SIZE (e.g. small = Z-Z) would omit data those queries need.
rm -rf "${TESTDB}/kdb"
rm -rf "${TESTDB}/parquet/rowgroup"

SIZE=full DATAFORMAT=kdb ./generateDB.sh "${TESTPSV}" "${TESTDB}/kdb" "${TESTDBDATE}"
SIZE=full SYMBOLSTOREDAS=ROWGROUP DATAFORMAT=parquet ./generateDB.sh "${TESTPSV}" "${TESTDB}/parquet/rowgroup" "${TESTDBDATE}"

# Generate the current query-parameter contract from this exact database. This
# avoids stale checked-in smoke fixtures when parameter names/query coverage
# evolve and guarantees the selected symbols exist in the test data.
PARAM_DIR=${TESTDB}/params
rm -rf "${PARAM_DIR}"
mkdir -p "${PARAM_DIR}"
q ./artifacts/parameters/genParameters.q -db "${TESTDB}/kdb" -dst "${PARAM_DIR}" -q

QUERY_ENGINE_ARGS=()
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
    QUERY_ENGINE_ARGS=(--engines "kdb,kdbxsql,duckdb,polars,pykx,pandas,rayforce")
fi

# Run the benchmarks.
rm -rf "${RESULTDIR}"

./benchmarks/inmemory/queryEngines.sh --db-dir "${TESTDB}" --param-dir "${PARAM_DIR}" --datadate "${TESTDBDATE}" --threads "4 16" --result-dir "${RESULTDIR}" "${QUERY_ENGINE_ARGS[@]}"
./benchmarks/inmemory/kdbAttributes.sh --db-dir "${TESTDB}" --param-dir "${PARAM_DIR}" --datadate "${TESTDBDATE}" --threads "4 16" --result-dir "${RESULTDIR}"

popd
