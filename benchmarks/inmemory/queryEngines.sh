#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

ENGINES="kdb,kdbxsql,duckdb,chdb,polars,pykx,pandas"
SOLUTIONS="KDB-X,DuckDB (Index),Polars,Pandas"
RESULT_DIR="./results/inmemory"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Options:
  --db-dir           Directory where databases will be generated
  -p, --param-dir    Directory of the query parameters
  -d, --datadate     Data date
  -t, --threads      Space-separated list of thread counts, e.g., "1 4 16", (default: "1 4")
  -e, --engines      Comma-separated list of engines to test (default: "$ENGINES")
  -s, --solutions    Comma-separated list of solutions to test, or "ALL" to test all available solutions (default: "$SOLUTIONS")
  -i, --idx          (optional) Filter queries by index: single (42), list (32,42,50), or range (40-44)
  -r, --result-dir   (optional) Directory to persist merged results (default: ${RESULT_DIR})
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
        -e|--engines)    ENGINES="$2"; shift 2 ;;
        -s|--solutions)  SOLUTIONS="$2"; shift 2 ;;
        -i|--idx)        IDX_PARAM="-idx $2"; shift 2 ;;
        -r|--result-dir) RESULT_DIR="$2"; shift 2 ;;
        -q|--query-output-dir) QUERY_OUTPUT_DIR="$2"; shift 2 ;;
        -h|--help)    usage ;;
        *) echo "Unknown option: $1"; usage ;;
    esac
done

# True when engine $1 is present in the comma-separated ENGINES list.
function engine_enabled() {
    [[ ",${ENGINES}," == *",${1},"* ]]
}

# True when solution $1 is present in the comma-separated SOLUTIONS list, or SOLUTIONS is "ALL".
function solution_enabled() {
    [[ "${SOLUTIONS}" == "ALL" ]] || [[ ",${SOLUTIONS}," == *",${1},"* ]]
}

init_benchmark

function execute_queries () {
    mkdir -p ${RESULT_DIR}
    echo "Running Queries..."
    local COMMONPARAMS="-date $DATADATE -storage_backend memory -querymeta ./artifacts/queries/inmemory/querymeta.psv -paramdir ${PARAM_DIR} ${IDX_PARAM}"
    for s in "${THREAD_NRS[@]}"; do
        echo "--> Running with $s threads"

        if engine_enabled kdb; then
            if solution_enabled "KDB-X"; then
                run_solution "KDB-X" q ./src/runQueries.q ${COMMONPARAMS} -db ${DB_DIR}/kdb -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -s ${s}
            fi

            if solution_enabled "KDB-X (Parted)"; then
                run_solution "KDB-X (Parted)" q ./src/runQueries.q ${COMMONPARAMS} -db ${DB_DIR}/kdb -sortcols "sym,time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb.psv -s ${s}
            fi

            if solution_enabled "KDB-X (Manual Opt)"; then
                run_solution "KDB-X (Manual Opt)" q ./src/runQueries.q ${COMMONPARAMS} -db ${DB_DIR}/kdb -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/kdb_manualopt.psv -s ${s}
            fi

            if solution_enabled "KDB-X (NoAttr)"; then
                run_solution "KDB-X (NoAttr)" q ./src/runQueries.q ${COMMONPARAMS} -db ${DB_DIR}/kdb -sortcols "time" -indexon "" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -s ${s}
            fi

            if solution_enabled "KDB-X (Time Sorted)"; then
                run_solution "KDB-X (Time Sorted)" q ./src/runQueries.q ${COMMONPARAMS} -db ${DB_DIR}/kdb -sortcols "time" -indexon "time" -queryfile ./artifacts/queries/inmemory/kdb_noattr.psv -s ${s}
            fi
        fi
        if engine_enabled kdbxsql; then
            if solution_enabled "KDB-X SQL"; then
                run_solution "KDB-X SQL" q ./src/runQueries.q ${COMMONPARAMS} -db ${DB_DIR}/kdb -engine sql -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/sql.psv -s ${s}
            fi
        fi
        if engine_enabled duckdb; then
            if solution_enabled "DuckDB (No index)"; then
                run_solution "DuckDB (No index)" env DUCKDB_THREADS=$(( s > 1 ? s : 1 )) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "time" -queryfile ./artifacts/queries/inmemory/duckdb.psv
            fi

            if solution_enabled "DuckDB (Sym, Time Sort)"; then
                run_solution "DuckDB (Sym, Time Sort)" env DUCKDB_THREADS=$(( s > 1 ? s : 1 )) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "sym,time" -queryfile ./artifacts/queries/inmemory/duckdb.psv
            fi

            if solution_enabled "DuckDB (Index)"; then
                run_solution "DuckDB (Index)" env DUCKDB_THREADS=$(( s > 1 ? s : 1 )) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -db ${DB_DIR}/parquet/rowgroup -engine duckdb_con -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/duckdb.psv
            fi
        fi
        if engine_enabled chdb; then
            if solution_enabled "chDB"; then
                run_solution "chDB" env CHDB_THREADS=$(( s > 1 ? s : 1 )) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -db ${DB_DIR}/parquet/rowgroup -engine chdb -sortcols "time" -queryfile ./artifacts/queries/inmemory/chdb.psv
            fi
        fi
        if engine_enabled polars; then
            if solution_enabled "Polars"; then
                run_solution "Polars" env POLARS_MAX_THREADS=$(( s > 1 ? s : 1 )) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -db ${DB_DIR}/parquet/rowgroup -engine polars -sortcols "time" -queryfile ./artifacts/queries/inmemory/polars.psv
            fi
        fi
        if engine_enabled pykx; then
            if solution_enabled "pykx"; then
                run_solution "pykx" env QARGS="-s ${s}" uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -db ${DB_DIR}/kdb -engine pykx -sortcols "time" -indexon "sym" -queryfile ./artifacts/queries/inmemory/pykx.psv
            fi
        fi
        if engine_enabled pandas; then
            if solution_enabled "Pandas"; then
                run_solution "Pandas" env OMP_NUM_THREADS=$(( s > 1 ? s : 1 )) NUMEXPR_NUM_THREADS=$(( s > 1 ? s : 1 )) MKL_NUM_THREADS=$(( s > 1 ? s : 1 )) uv run pysrc/queryrunner/main.py ${COMMONPARAMS} -db ${DB_DIR}/parquet/rowgroup -engine pandas -sortcols "time" -queryfile ./artifacts/queries/inmemory/pandas.psv
            fi
        fi
    done
}

run_suite
