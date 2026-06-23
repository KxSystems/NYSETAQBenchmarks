#!/usr/bin/env bash

set -euo pipefail

script_dir=$(dirname "${BASH_SOURCE[0]}")
source "${script_dir}/../../external/kx/taq/scripts/util.sh"

THREAD_NRS=(1 4)
RESULT_DIR="./results/inmemory/queryengines"
STATS_DIR="./results/inmemory/queryengines"
ENGINES="kdb,sql,duckdb,polars,pykx,pandas"
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
  -e, --engines      Comma-separated list of engines to test (default: "kdb,sql,duckdb,polars,pykx,pandas")
  -s, --stats-dir    Directory to save table stats (default: ${STATS_DIR})
  -i, --idx          Filter queries by index: single (42), list (32,42,50), or range (40-44)
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
        -r|--result-dir) RESULT_DIR="$2"; shift 2 ;;
        -e|--engines)    ENGINES="$2"; shift 2 ;;
        -s|--stats-dir)  STATS_DIR="$2"; shift 2 ;;
        -i|--idx)        IDX_PARAM="-idx $2"; shift 2 ;;
        -h|--help)    usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

check_date $DATE

export FLUSH=${script_dir}/../../flush/noflush.sh # Set FLUSH to a no-op script since we're working with in-memory data

function engine_enabled() {
    [[ ",${ENGINES}," == *",${1},"* ]]
}

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
    local COMMONPARAMS="-storage_backend inmemory -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM}"
    for s in "${THREAD_NRS[@]}"; do
        echo "--> Running with $s threads"

        if engine_enabled kdb; then
            $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/kdb -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -result ${RESULT_DIR}/kdb_${s}Threads.psv -s ${s}
            $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/kdb -sortcols "sym,time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -result ${RESULT_DIR}/kdbParted_${s}Threads.psv -s ${s}
        fi
        if engine_enabled sql; then
            $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/kdb -engine sql -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/sql.psv -result ${RESULT_DIR}/kdbxsql_${s}Threads.psv -s ${s}
        fi
        if engine_enabled duckdb; then
            DUCKDB_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "time" -queryfile ./artifacts/queries/inmemory/duckdb.psv -result ${RESULT_DIR}/duckdb_${s}Threads.psv
            DUCKDB_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "sym,time" -queryfile ./artifacts/queries/inmemory/duckdb.psv -result ${RESULT_DIR}/duckdbSymTimeSort_${s}Threads.psv
            DUCKDB_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/duckdb.psv -result ${RESULT_DIR}/duckdbIndex_${s}Threads.psv
        fi
        if engine_enabled polars; then
            POLARS_MAX_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine polars -sortcols "time" -queryfile ./artifacts/queries/inmemory/polars.psv -result ${RESULT_DIR}/polars_${s}Threads.psv
        fi
        if engine_enabled pykx; then
            QARGS="-s ${s}" $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/kdb -engine pykx -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/pykx.psv -result ${RESULT_DIR}/pykx_kdb_${s}Threads.psv
        fi
        if engine_enabled pandas; then
            OMP_NUM_THREADS=$(( s > 1 ? s : 1 )) NUMEXPR_NUM_THREADS=$(( s > 1 ? s : 1 )) MKL_NUM_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py -engine pandas -sortcols "time" -date $DATE -db ${DB_DIR}/parquet/rowgroup -queryfile ./artifacts/queries/inmemory/pandas.psv ${COMMONPARAMS} -result ${RESULT_DIR}/pandasInMemory_${s}Threads.psv
        fi
    done
}

function get_table_stats () {
    local COMMONPARAMS="-storage_backend inmemory -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM}"
    echo "Getting table stats..."
    mkdir -p ${STATS_DIR}/{kdb,kdbParted,kdbxsql,duckdb,duckdb_index,polars,pandas}
    if engine_enabled kdb; then
        /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/kdb -sortcols time -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -tags none -tableStatsDir ${STATS_DIR}/kdb -q 2> ${STATS_DIR}/kdb/os.txt
        /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/kdb -sortcols "sym,time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -tags none -tableStatsDir ${STATS_DIR}/kdbParted-q 2> ${STATS_DIR}/kdbParted/os.txt
    fi
    if engine_enabled sql; then # same as kdb+ inmemory grouped
        /usr/bin/time -v q ./src/runQueries.q ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/kdb -sortcols time -indexon "sym" -queryfile ./artifacts/queries/inmemory/sql.psv -tags none -tableStatsDir ${STATS_DIR}/kdbxsql -q 2> ${STATS_DIR}/kdbxsql/os.txt
    fi
    if engine_enabled duckdb; then
        /usr/bin/time -v uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -queryfile ./artifacts/queries/inmemory/duckdb.psv -tags none -tableStatsDir ${STATS_DIR}/duckdb 2> ${STATS_DIR}/duckdb/os.txt
        /usr/bin/time -v uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con_index -queryfile ./artifacts/queries/inmemory/duckdb.psv -tags none -tableStatsDir ${STATS_DIR}/duckdb_index 2> ${STATS_DIR}/duckdb_index/os.txt
    fi
    if engine_enabled polars; then
        /usr/bin/time -v uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine polars -queryfile ./artifacts/queries/inmemory/polars.psv -tags none -tableStatsDir ${STATS_DIR}/polars 2> ${STATS_DIR}/polars/os.txt
    fi
    if engine_enabled pandas; then
        /usr/bin/time -v uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine pandas -queryfile ./artifacts/queries/inmemory/pandas.psv -tags none -tableStatsDir ${STATS_DIR}/pandas 2> ${STATS_DIR}/pandas/os.txt
    fi
}

START_TIME=$(date +%s)

execute_queries
get_table_stats

echo "Benchmark suite complete."
END_TIME=$(date +%s)
echo "Benchmark completed successfully in $(date -u -d "@$((END_TIME - START_TIME))" +%T)"