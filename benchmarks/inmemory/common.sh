#!/usr/bin/env bash
#
# Shared helpers for the in-memory benchmark scripts in this directory
# (queryEngines.sh, kdbAttributes.sh). Source it near the top of each script:
#
#     source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
#
# It sources util.sh and provides the defaults and helper functions common to
# all in-memory benchmarks. Each script still defines its own usage(), argument
# parsing, execute_queries() and get_table_stats(); it then calls
# init_benchmark after parsing args and run_suite at the end.

COMMON_DIR=$(dirname "${BASH_SOURCE[0]}")
source "${COMMON_DIR}/../../external/kx/taq/scripts/util.sh"

# Defaults shared by all in-memory benchmark scripts. Scripts may add their own
# defaults and override these during argument parsing.
THREAD_NRS=(1 4)
IDX_PARAM=""
QUERY_OUTPUT_DIR=""

# Emit the -queryOutputDir flag for the per-engine subdirectory $1, or nothing
# when query output persistence is disabled (no -q/--query-output-dir given).
# The subdirectory is created here because runQueries.q writes into it without
# creating it (main.py does mkdir, but the q engines rely on it existing).
function query_output_param() {
    if [[ -n "${QUERY_OUTPUT_DIR}" ]]; then
        mkdir -p "${QUERY_OUTPUT_DIR}/$1"
        echo "-queryOutputDir ${QUERY_OUTPUT_DIR}/$1"
    fi
}

# Validate DATE, create the scratch result directory, and point FLUSH at the
# no-op script (in-memory data needs no cache flush). Call after parsing args.
function init_benchmark () {
    check_date $DATE

    # Per-engine result PSVs are written to a scratch directory and then merged
    # into RESULTS_FILE; the scratch directory is removed on exit.
    RESULT_DIR="$(dirname "${RESULTS_FILE}")/tmp"
    trap 'rm -rf "${RESULT_DIR}"' EXIT

    # Set FLUSH to a no-op script since we're working with in-memory data
    export FLUSH=${COMMON_DIR}/../../flush/noflush.sh
}

# Write a YAML snapshot of the run parameters, environment and host system to a file.
function save_environment () {
    local out=$1

    local cpu_model cpu_arch sockets cores_per_socket threads_per_core
    if [[ $(uname) == "Linux" ]]; then
        sockets=$(lscpu | awk -F: '/^Socket\(s\):/{gsub(/[ \t]/,"",$2); print $2}')
        cores_per_socket=$(lscpu | awk -F: '/^Core\(s\) per socket:/{gsub(/[ \t]/,"",$2); print $2}')
        threads_per_core=$(lscpu | awk -F: '/^Thread\(s\) per core:/{gsub(/[ \t]/,"",$2); print $2}')
        cpu_model=$(lscpu | awk -F: '/^Model name:/{gsub(/^[ \t]+/,"",$2); print $2}')
    else
        sockets=1
        cores_per_socket=$(sysctl -n hw.ncpu)
        threads_per_core=1
        cpu_model=$(sysctl -n machdep.cpu.brand_string)
    fi
    cpu_arch=$(arch)

    cat > "${out}" <<EOF
test time: "$(date)"
parameters:
  db-dir: "${DB_DIR}"
  date: "${DATE}"
envvars:
  NUMANODE: "${NUMANODE:-}"
system:
  os:
    name: "$(uname)"
    kernel: "$(uname -r)"
  cpu:
    arch: "${cpu_arch}"
    model: "${cpu_model}"
    socketnr: ${sockets}
    corepersocket: ${cores_per_socket}
    threadpercore: ${threads_per_core}
EOF

    echo "Saved environment info to ${out}"
}

function get_numa_config () {
    if [[ -z "${NUMANODE:-}" ]]; then
        echo ""
        return
    fi

    echo "numactl -N ${NUMANODE} -m ${NUMANODE}"
}

# Prepend a 'nickname' column to a result PSV. The runners are unaware of
# nicknames (e.g. 'kdb' vs 'kdbParted' are the same engine/runner with different
# sort/index options), so we label each result file here using the predefined
# nickname for the run that produced it.
function add_nickname () {
    local file="$1" nick="$2"
    [[ -f "${file}" ]] || return 0
    awk -v nick="${nick}" 'BEGIN{FS=OFS="|"} {print (NR==1 ? "nickname" : nick), $0}' "${file}" > "${file}.tmp"
    mv "${file}.tmp" "${file}"
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

# Run the full benchmark suite and report total wall-clock time. Relies on the
# sourcing script having defined execute_queries and get_table_stats.
function run_suite () {
    local start_time end_time
    start_time=$(date +%s)

    execute_queries
    [[ -n "${STATS_DIR:-}" ]] && get_table_stats
    merge_results

    echo "Benchmark suite complete."
    end_time=$(date +%s)
    echo "Benchmark completed successfully in $(date -u -d "@$((end_time - start_time))" +%T)"
}
