#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

STATS_DIR=""
ENGINES="kdb,sql,duckdb,polars,pykx,pandas,rayforce"
RESULTS_FILE="./results/inmemory/queryengines.psv"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --db-dir           Directory where databases will be generated
  -p, --param-dir    Directory of the query parameters
  -d, --date         Target date
  -t, --threads      Space-separated list of thread counts, e.g., "1 4 16", (default: "1 4")
  -e, --engines      Comma-separated list of engines to test (default: "kdb,sql,duckdb,polars,pykx,pandas,rayforce")
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
        -e|--engines)    ENGINES="$2"; shift 2 ;;
        -s|--stats-dir)  STATS_DIR="$2"; shift 2 ;;
        -i|--idx)        IDX_PARAM="-idx $2"; shift 2 ;;
        -r|--results)    RESULTS_FILE="$2"; shift 2 ;;
        -q|--query-output-dir) QUERY_OUTPUT_DIR="$2"; shift 2 ;;
        -h|--help)    usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# True when engine $1 is present in the comma-separated ENGINES list.
function engine_enabled() {
    [[ ",${ENGINES}," == *",${1},"* ]]
}

init_benchmark

function execute_queries () {
    mkdir -p ${RESULT_DIR}
    echo "Running Queries..."
    local COMMONPARAMS="-storage_backend memory -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM}"
    for s in "${THREAD_NRS[@]}"; do
        echo "--> Running with $s threads"

        if engine_enabled kdb; then
            $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param kdb) -date $DATE -db ${DB_DIR}/kdb -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -result ${RESULT_DIR}/kdb_${s}Threads.psv -s ${s}
            add_nickname ${RESULT_DIR}/kdb_${s}Threads.psv "kdb"
            $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param kdb) -date $DATE -db ${DB_DIR}/kdb -sortcols "sym,time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -result ${RESULT_DIR}/kdbParted_${s}Threads.psv -s ${s}
            add_nickname ${RESULT_DIR}/kdbParted_${s}Threads.psv "kdbParted"
        fi
        if engine_enabled sql; then
            $(get_numa_config) q ./src/runQueries.q ${COMMONPARAMS} $(query_output_param sql) -date $DATE -db ${DB_DIR}/kdb -engine sql -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/sql.psv -result ${RESULT_DIR}/kdbxsql_${s}Threads.psv -s ${s}
            add_nickname ${RESULT_DIR}/kdbxsql_${s}Threads.psv "kdbxsql"
        fi
        if engine_enabled duckdb; then
            DUCKDB_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} $(query_output_param duckdb) -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "time" -queryfile ./artifacts/queries/inmemory/duckdb.psv -result ${RESULT_DIR}/duckdb_${s}Threads.psv
            add_nickname ${RESULT_DIR}/duckdb_${s}Threads.psv "duckdb"
            DUCKDB_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} $(query_output_param duckdb) -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "sym,time" -queryfile ./artifacts/queries/inmemory/duckdb.psv -result ${RESULT_DIR}/duckdbSymTimeSort_${s}Threads.psv
            add_nickname ${RESULT_DIR}/duckdbSymTimeSort_${s}Threads.psv "duckdbSymTimeSort"
            DUCKDB_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} $(query_output_param duckdb) -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/duckdb.psv -result ${RESULT_DIR}/duckdbIndex_${s}Threads.psv
            add_nickname ${RESULT_DIR}/duckdbIndex_${s}Threads.psv "duckdbIndex"
        fi
        if engine_enabled polars; then
            POLARS_MAX_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} $(query_output_param polars) -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine polars -sortcols "time" -queryfile ./artifacts/queries/inmemory/polars.psv -result ${RESULT_DIR}/polars_${s}Threads.psv
            add_nickname ${RESULT_DIR}/polars_${s}Threads.psv "polars"
        fi
        if engine_enabled pykx; then
            QARGS="-s ${s}" $(get_numa_config) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} $(query_output_param pykx) -date $DATE -db ${DB_DIR}/kdb -engine pykx -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/pykx.psv -result ${RESULT_DIR}/pykx_kdb_${s}Threads.psv
            add_nickname ${RESULT_DIR}/pykx_kdb_${s}Threads.psv "pykx"
        fi
        if engine_enabled pandas; then
            OMP_NUM_THREADS=$(( s > 1 ? s : 1 )) NUMEXPR_NUM_THREADS=$(( s > 1 ? s : 1 )) MKL_NUM_THREADS=$(( s > 1 ? s : 1 )) $(get_numa_config) uv run pysrc/queryrunner/main.py -engine pandas -sortcols "time" -date $DATE -db ${DB_DIR}/parquet/rowgroup -queryfile ./artifacts/queries/inmemory/pandas.psv ${COMMONPARAMS} $(query_output_param pandas) -result ${RESULT_DIR}/pandasInMemory_${s}Threads.psv
            add_nickname ${RESULT_DIR}/pandasInMemory_${s}Threads.psv "pandas"
        fi
        if engine_enabled rayforce; then
            # Rayforce loads its native splayed DB (${DB_DIR}/rayforce) fully into
            # memory. -c is the worker-pool size, so 0 secondary threads maps to a
            # single-core pool.
            RAYCORES=$(( s > 1 ? s : 1 ))
            RAY_OUTPUT_ARGS=()
            if [[ -n "${QUERY_OUTPUT_DIR}" ]]; then
                RAY_OUTPUT_ARGS=(--query-output-dir "${QUERY_OUTPUT_DIR}/rayforce")
            fi
            $(get_numa_config) bash ./src/rayforce/runRayforce.sh \
                --db-dir ${DB_DIR} --param-dir ${PARAM_DIR} --date $DATE --cores ${RAYCORES} --thread-label ${s} --layout grouped \
                --queryfile ./artifacts/queries/inmemory/rayforce.psv \
                --result ${RESULT_DIR}/rayforce_${s}Threads.psv \
                "${RAY_OUTPUT_ARGS[@]}" \
                ${IDX_PARAM:+--idx ${IDX_PARAM#-idx }}
            add_nickname ${RESULT_DIR}/rayforce_${s}Threads.psv "rayforce"
            $(get_numa_config) bash ./src/rayforce/runRayforce.sh \
                --db-dir ${DB_DIR} --param-dir ${PARAM_DIR} --date $DATE --cores ${RAYCORES} --thread-label ${s} --layout parted \
                --queryfile ./artifacts/queries/inmemory/rayforce.psv \
                --result ${RESULT_DIR}/rayforceParted_${s}Threads.psv \
                "${RAY_OUTPUT_ARGS[@]}" \
                ${IDX_PARAM:+--idx ${IDX_PARAM#-idx }}
            add_nickname ${RESULT_DIR}/rayforceParted_${s}Threads.psv "rayforceParted"
        fi
    done
}

function get_table_stats () {
    local COMMONPARAMS="-storage_backend memory -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM}"
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
        /usr/bin/time -v uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "time" -queryfile ./artifacts/queries/inmemory/duckdb.psv -tags none -tableStatsDir ${STATS_DIR}/duckdb 2> ${STATS_DIR}/duckdb/os.txt
        /usr/bin/time -v uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/duckdb.psv -tags none -tableStatsDir ${STATS_DIR}/duckdb_index 2> ${STATS_DIR}/duckdb_index/os.txt
    fi
    if engine_enabled polars; then
        /usr/bin/time -v uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine polars -sortcols "time" -queryfile ./artifacts/queries/inmemory/polars.psv -tags none -tableStatsDir ${STATS_DIR}/polars 2> ${STATS_DIR}/polars/os.txt
    fi
    if engine_enabled pandas; then
        /usr/bin/time -v uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -date $DATE -db ${DB_DIR}/parquet/rowgroup -engine pandas -sortcols "time" -queryfile ./artifacts/queries/inmemory/pandas.psv -tags none -tableStatsDir ${STATS_DIR}/pandas 2> ${STATS_DIR}/pandas/os.txt
    fi

    save_environment ${STATS_DIR}/environment.yaml
}

function merge_results () {
    echo "Merging result files into ${RESULTS_FILE}..."

    local files=()
    while IFS= read -r f; do
        files+=("$f")
    done < <(find "${RESULT_DIR}" -maxdepth 1 -type f -name '*.psv' | sort)

    if [[ ${#files[@]} -eq 0 ]]; then
        echo "No result PSV files found in ${RESULT_DIR}; nothing to merge."
        return
    fi

    mkdir -p "$(dirname "${RESULTS_FILE}")"
    # All per-engine PSVs share an identical header; keep it from the first file
    # only, then append the data rows from every file.
    awk 'FNR==1 && NR!=1 { next } { print }' "${files[@]}" > "${RESULTS_FILE}"
    echo "Merged ${#files[@]} result file(s) -> ${RESULTS_FILE}"
}

run_suite
