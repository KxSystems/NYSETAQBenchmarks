#!/usr/bin/env bash
#
# Shared helpers for the in-memory benchmark scripts in this directory
# (queryEngines.sh, kdbAttributes.sh). Source it near the top of each script:
#
#     source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
#
# It sources util.sh and provides the defaults and helper functions common to
# all in-memory benchmarks. Each script still defines its own usage(), argument
# parsing and execute_queries(); it then calls
# init_benchmark after parsing args and run_suite at the end.

COMMON_DIR=$(dirname "${BASH_SOURCE[0]}")
source "${COMMON_DIR}/../../external/kx/taq/scripts/util.sh"

# Defaults shared by all in-memory benchmark scripts. Scripts may add their own
# defaults and override these during argument parsing.
THREAD_NRS=(1 4)
IDX_PARAM=""
QUERY_OUTPUT_DIR=""

# Validate DATE, create the scratch result directory, and point FLUSH at the
# no-op script (in-memory data needs no cache flush). Call after parsing args.
function init_benchmark () {
    check_date $DATADATE

    # Per-engine result PSVs are written to a scratch directory and then merged
    # into RESULT_DIR/results.psv; the scratch directory is removed on exit.
    RESULT_TMP_DIR="${RESULT_DIR}/tmp"
    trap 'rm -rf "${RESULT_TMP_DIR}"' EXIT

    # Set FLUSH to a no-op script since we're working with in-memory data
    export FLUSH=${COMMON_DIR}/../../flush/noflush.sh
}

# Write a YAML snapshot of the run parameters, environment and host system to a file.
function save_environment () {
    local out=$1
    mkdir -p "$(dirname "${out}")"

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
test date: "$(date +%Y-%m-%d)"
test time: "$(date +%H:%M:%S)"
parameters:
  db-dir: "${DB_DIR}"
  datadate: "${DATADATE}"
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

# Prepend a 'solution' column to a result PSV. The runners are unaware of
# nicknames (e.g. 'kdb' vs 'kdbParted' are the same engine/runner with different
# sort/index options), so we label each result file here using the predefined
# solution for the run that produced it.
function add_solution_name () {
    local sol="$1" file="$2" statsfile=$3
    [[ -f "${file}" ]] || return 0
    awk -v sol="${sol}" 'BEGIN{FS=OFS="|"} {print (NR==1 ? "solution" : sol), $0}' "${file}" > "${file}.tmp"
    mv "${file}.tmp" "${file}"
    if [[ -f "${statsfile}" ]]; then
        { echo "solution: ${sol}"; cat "${statsfile}"; } > "${statsfile}.tmp"
        mv "${statsfile}.tmp" "${statsfile}"
    fi
}

# Run one named solution's query command: compute its per-solution result
# path, append -queryOutputDir/-result to the command given in $2..., run it,
# then label the resulting PSV via add_solution_name. Relies on $s (thread count)
# and $RESULT_DIR from the enclosing loop in execute_queries.
function run_solution () {
    local solution="$1"
    shift
    local safe=$(echo "${solution}" | sed -E 's/[^a-zA-Z0-9._-]+/_/g')
    mkdir -p "${RESULT_DIR}/${safe}"
    local result=${RESULT_TMP_DIR}/${safe}_${s}Threads.psv
    local query_output_param=""
    if [[ -n "${QUERY_OUTPUT_DIR}" ]]; then
        # The subdirectory is created here because runQueries.q writes into it
        # without creating it (main.py does mkdir, but the q engines rely on
        # it existing).
        mkdir -p "${QUERY_OUTPUT_DIR}/${safe}"
        query_output_param="-queryOutputDir ${QUERY_OUTPUT_DIR}/${safe}"
    fi
    $(get_numa_config) /usr/bin/time -v "$@" ${query_output_param} -result ${result} -tableStatsDir ${RESULT_DIR}/${safe} 2> ${RESULT_DIR}/${safe}/os.txt
    add_solution_name "${solution}" ${result} ${RESULT_DIR}/${safe}/stats.yaml
}

function merge_results () {
    local RESULT_FILE="${RESULT_DIR}/results.psv"
    mkdir -p "${RESULT_DIR}"
    echo "Merging result files into ${RESULT_FILE}..."

    local files=()
    while IFS= read -r f; do
        files+=("$f")
    done < <(find "${RESULT_TMP_DIR}" -maxdepth 1 -type f -name '*.psv' | sort)

    if [[ ${#files[@]} -eq 0 ]]; then
        echo "No result PSV files found in ${RESULT_TMP_DIR}; nothing to merge."
        return
    fi

    # All per-engine PSVs share an identical header; keep it from the first file
    # only, then append the data rows from every file.
    awk 'FNR==1 && NR!=1 { next } { print }' "${files[@]}" > "${RESULT_FILE}"
    echo "Merged ${#files[@]} result file(s) -> ${RESULT_FILE}"
}


# Run the full benchmark suite and report total wall-clock time. Relies on the
# sourcing script having defined execute_queries.
function run_suite () {
    local start_time end_time
    start_time=$(date +%s)

    save_environment "${RESULT_DIR}/environment.yaml"
    execute_queries
    merge_results

    echo "Benchmark suite complete."
    end_time=$(date +%s)

    local elapsed=$((end_time - start_time))

    echo "Benchmark completed successfully in $((elapsed / 86400))d $(date -u -d "@$((elapsed % 86400))" +%T)"
}
