#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

RESULT_DIR="./results/inmemory"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --db-dir           Directory where databases will be generated
  -p, --param-dir    Directory of the query parameters
  -d, --datadate     Data date
  -t, --threads      Space-separated list of thread counts, e.g., "1 4 16", (default: "1 4")
  -i, --idx          (optional) Filter queries by index: single (42), list (32,42,50), or range (40-44)
  -r, --result-dir   (optional) Directory to persist merged results (default: ${RESULTS_FILE})
  -q, --query-output-dir (optional) Directory to persist query outputs
  -h, --help         Show this help message
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --db-dir)        DB_DIR="$2"; shift 2 ;;
        -p|--param-dir)  PARAM_DIR="$2"; shift 2 ;;
        -d|--datadate)   DATADATE="$2"; shift 2 ;;
        -t|--threads)    read -ra THREAD_NRS <<< "$2"; shift 2 ;;
        -i|--idx)        IDX_PARAM="-idx $2"; shift 2 ;;
        -r|--result-dir) RESULT_DIR="$2"; shift 2 ;;
        -q|--query-output-dir) QUERY_OUTPUT_DIR="$2"; shift 2 ;;
        -h|--help)    usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

init_benchmark

function execute_queries () {
    mkdir -p ${RESULT_DIR}
    echo "Running Queries..."
    local COMMONPARAMS="-date $DATADATE -db ${DB_DIR}/kdb -storage_backend memory -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM}"
    for s in "${THREAD_NRS[@]}"; do
        echo "--> Running with $s threads"

        run_solution "KDB-X (NoAttr)" q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -s ${s}

        run_solution "KDB-X (Time Sorted)" q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "time" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -s ${s}

        run_solution "KDB-X" q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -s ${s}

        run_solution "KDB-X (Manual Opt)" q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb_manualopt.psv -s ${s}

        run_solution "KDB-X (Parted)" q ./src/runQueries.q ${COMMONPARAMS} -sortcols "sym,time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -s ${s}

        run_solution "KDB-X (Table Dict)" q ./src/runQueries.q ${COMMONPARAMS} -format tabledict -sortcols "time" -queryfile ./artifacts/queries/inmemory/kdb_tabledict.psv -s ${s}

        run_solution "KDB-X (Table Dict Peach)" env EACHPEACH=peach q ./src/runQueries.q ${COMMONPARAMS} -format tabledict -sortcols "time" -queryfile ./artifacts/queries/inmemory/kdb_tabledict.psv -s ${s}
    done
}

run_suite
