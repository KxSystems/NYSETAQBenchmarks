#!/usr/bin/env bash
#
# Smoke test for the in-memory benchmark suite. Generates a small kdb+ and
# Parquet database from the TAQ submodule's test PSV files, then runs both
# in-memory benchmark scripts against it. This only checks that the pipeline
# runs end-to-end; it does not assert anything about the result PSVs

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
rm -rf ${TESTDB}/kdb
rm -rf ${TESTDB}/parquet/rowgroup

SIZE=full DATAFORMAT=kdb ./generateDB.sh ${TESTPSV} ${TESTDB}/kdb ${TESTDBDATE}
SIZE=full SYMBOLSTOREDAS=ROWGROUP DATAFORMAT=parquet ./generateDB.sh ${TESTPSV} ${TESTDB}/parquet/rowgroup ${TESTDBDATE}

# Run the benchmarks.
rm -rf ${RESULTDIR}

PARAM_DIR=./artifacts/parameters/test
./benchmarks/inmemory/queryEngines.sh --db-dir ${TESTDB} --param-dir ${PARAM_DIR} --date ${TESTDBDATE} --threads "4 16" --results ${RESULTDIR}/queryengines.psv --stats-dir ${RESULTDIR}/queryengines
./benchmarks/inmemory/kdbAttributes.sh --db-dir ${TESTDB} --param-dir ${PARAM_DIR} --date ${TESTDBDATE} --threads "4 16" --results ${RESULTDIR}/kdbattr.psv --stats-dir ${RESULTDIR}/kdbattr

popd