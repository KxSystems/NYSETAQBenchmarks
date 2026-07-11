#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

STATS_DIR=""
RESULTS_FILE="./results/inmemory/kdbattributes.psv"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --db-dir           Directory where databases will be generated
  -p, --param-dir    Directory of the query parameters
  -d, --date         Target date
  -t, --threads      Space-separated list of thread counts, e.g., "1 4 16", (default: "1 4")
  -s, --stats-dir    (optional) Directory to save table and environment statistics
  -i, --idx          (optional) Filter queries by index: single (42), list (32,42,50), or range (40-44)
  -r, --results      (optional) Single PSV that all per-engine results are merged into (default: ${RESULTS_FILE})
  -q, --query-output-dir (optional) Directory to persist query outputs
  -h, --help         Show this help message
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --db-dir)        DB_DIR="$2"; shift 2 ;;
        -p|--param-dir)  PARAM_DIR="$2"; shift 2 ;;
        -d|--date)       DATE="$2"; shift 2 ;;
        -t|--threads)    read -ra THREAD_NRS <<< "$2"; shift 2 ;;
        -s|--stats-dir)  STATS_DIR="$2"; shift 2 ;;
        -i|--idx)        IDX_PARAM="-idx $2"; shift 2 ;;
        -r|--results)    RESULTS_FILE="$2"; shift 2 ;;
        -q|--query-output-dir) QUERY_OUTPUT_DIR="$2"; shift 2 ;;
        -h|--help)    usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

init_benchmark

function execute_queries () {
    mkdir -p ${RESULT_DIR}
    echo "Running Queries..."
    local COMMONPARAMS="-date $DATE -db ${DB_DIR}/kdb -storage_backend memory -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM}"
    for s in "${THREAD_NRS[@]}"; do
        echo "--> Running with $s threads"

        solution="kdbNoAttr"
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param $solution) -sortcols "time" -indexon "" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -result ${RESULT_DIR}/$nickname_${s}Threads.psv -s ${s}
        add_nickname ${RESULT_DIR}/$nickname_${s}Threads.psv $solution

        solution="kdbTimeSorted"
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param $solution) -sortcols "time" -indexon "time" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -result ${RESULT_DIR}/$nickname_${s}Threads.psv -s ${s}
        add_nickname ${RESULT_DIR}/$nickname_${s}Threads.psv $solution

        solution="kdb"
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param $solution) -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -result ${RESULT_DIR}/$nickname_${s}Threads.psv -s ${s}
        add_nickname ${RESULT_DIR}/$nickname_${s}Threads.psv $solution

        solution="kdbManualOpt"
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param $solution) -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb_manualopt.psv -result ${RESULT_DIR}/$nickname_${s}Threads.psv -s ${s}
        add_nickname ${RESULT_DIR}/$nickname_${s}Threads.psv $solution

        solution="kdbParted"
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param $solution) -sortcols "sym,time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -result ${RESULT_DIR}/$nickname_${s}Threads.psv -s ${s}
        add_nickname ${RESULT_DIR}/$nickname_${s}Threads.psv $solution

        solution="kdbTableDict"
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param $solution) -format tabledict -sortcols "time" -queryfile ./artifacts/queries/inmemory/kdb_tabledict.psv -result ${RESULT_DIR}/$nickname_${s}Threads.psv -s ${s}
        add_nickname ${RESULT_DIR}/$nickname_${s}Threads.psv $solution

        solution="kdbTableDictPeach"
        EACHPEACH=peach $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param $solution) -format tabledict -sortcols "time" -queryfile ./artifacts/queries/inmemory/kdb_tabledict.psv -result ${RESULT_DIR}/$nickname_${s}Threads.psv -s ${s}
        add_nickname ${RESULT_DIR}/$nickname_${s}Threads.psv $solution
    done
}

function get_table_stats () {
    local COMMONPARAMS="-date $DATE -db ${DB_DIR}/kdb -storage_backend memory -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM} -tags none"
    echo "Getting table stats..."
    mkdir -p ${STATS_DIR}/{kdbNoAttr,kdbTimeSorted,kdb,kdbParted}

    /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -tableStatsDir ${STATS_DIR}/kdbNoAttr -q 2> ${STATS_DIR}/kdbNoAttr/os.txt
    /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "time" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -tableStatsDir ${STATS_DIR}/kdbTimeSorted -q 2> ${STATS_DIR}/kdbTimeSorted/os.txt
    /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -tableStatsDir ${STATS_DIR}/kdb -q 2> ${STATS_DIR}/kdb/os.txt
    /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -sortcols "sym,time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -tableStatsDir ${STATS_DIR}/kdbParted -q 2> ${STATS_DIR}/kdbParted/os.txt

    save_environment ${STATS_DIR}/environment.yaml
}

run_suite
