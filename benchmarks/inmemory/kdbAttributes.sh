#!/usr/bin/env bash

set -euo pipefail

script_dir=$(dirname "${BASH_SOURCE[0]}")
source "${script_dir}/../../external/kx/taq/scripts/util.sh"

THREAD_NRS=(1 4)
RESULT_DIR="./results/inmemory/kdbattributes"
STATS_DIR="./results/inmemory/kdbattributes"
IDX_PARAM=""

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --db-dir           Directory where databases will be generated
  -p, --param-dir    Directory of the query parameters
  -d, --date         Target date
  -t, --threads      Space-separated list of thread counts, e.g., "1 4 16", (default: "1 4")
  -r, --result-dir   Directory for query results (default: ${RESULT_DIR})
  -s, --stats-dir    Directory to save table stats (default: ${STATS_DIR})
  -i, --idx          Filter queries by index: single (42), list (32,42,50), or range (40-44)
  -h, --help         Show this help message
  --stats-dir        Directory to save table stats (default: ./stats)
EOF
    exit 1
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --db-dir)        DB_DIR="$2"; shift 2 ;;
        -p|--param-dir)  PARAM_DIR="$2"; shift 2 ;;
        -d|--date)       DATE="$2"; shift 2 ;;
        -t|--threads)    read -ra THREAD_NRS <<< "$2"; shift 2 ;;
        -r|--result-dir) RESULT_DIR="$2"; shift 2 ;;
        -s|--stats-dir)  STATS_DIR="$2"; shift 2 ;;
        -i|--idx)        IDX_PARAM="-idx $2"; shift 2 ;;
        -h|--help)    usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

check_date $DATE

export FLUSH=${script_dir}/../../flush/noflush.sh # Set FLUSH to a no-op script since we're working with in-memory data

function get_numa_config () {
    if [[ -z "${NUMANODE:-}" ]]; then
        echo ""
        return
    fi

    echo "numactl -N ${NUMANODE} -m ${NUMANODE}"
}
function execute_queries () {
    mkdir -p ${RESULT_DIR}
    echo "Running Queries..."
    local COMMONPARAMS="-date $DATE -db ${DB_DIR}/kdb -storage_backend INMEMORY -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM}"
    for s in "${THREAD_NRS[@]}"; do
        echo "--> Running with $s threads"

        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -result ${RESULT_DIR}/kdbNoAttr_${s}Threads.psv -s ${s}
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "time" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -result ${RESULT_DIR}/kdbTimeSorted_${s}Threads.psv -s ${s}
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -result ${RESULT_DIR}/kdb_${s}Threads.psv -s ${s}
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} -sortcols "sym,time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -result ${RESULT_DIR}/kdbParted_${s}Threads.psv -s ${s}
        $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} -format tabledict -sortcols time -queryfile ./artifacts/queries/inmemory/kdb_tabledict.psv -result ${RESULT_DIR}/kdbTableDict_${s}Threads.psv -s ${s}
        EACHPEACH=peach $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} -format tabledict -sortcols time -queryfile ./artifacts/queries/inmemory/kdb_tabledict.psv -result ${RESULT_DIR}/kdbTableDictPeach_${s}Threads.psv -s ${s}
    done
}

function get_table_stats () {
    local COMMONPARAMS="-date $DATE -db ${DB_DIR}/kdb -storage_backend INMEMORY -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM} -tags none"
    echo "Getting table stats..."
    mkdir -p ${STATS_DIR}/{kdbNoAttr,kdbTimeSorted,kdb,kdbParted}

    /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -tableStatsDir ${STATS_DIR}/kdbNoAttr -q 2> ${STATS_DIR}/kdbNoAttr/os.txt
    /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "time" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -tableStatsDir ${STATS_DIR}/kdbTimeSorted -q 2> ${STATS_DIR}/kdbTimeSorted/os.txt
    /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -tableStatsDir ${STATS_DIR}/kdb -q 2> ${STATS_DIR}/kdb/os.txt
    /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -sortcols "sym,time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -tableStatsDir ${STATS_DIR}/kdbParted -q 2> ${STATS_DIR}/kdbParted/os.txt
}

START_TIME=$(date +%s)

execute_queries
get_table_stats

echo "Benchmark suite complete."
END_TIME=$(date +%s)
echo "Benchmark completed successfully in $(date -u -d "@$((END_TIME - START_TIME))" +%T)"