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
        numa_nodes=$(lscpu | awk -F: '/^NUMA node\(s\):/{gsub(/[ \t]/,"",$2); print $2}')
        l1d_cache=$(lscpu | awk -F: '/^L1d cache:/{gsub(/^[ \t]+/,"",$2); print $2}')
        l2_cache=$(lscpu | awk -F: '/^L2 cache:/{gsub(/^[ \t]+/,"",$2); print $2}')
        l3_cache=$(lscpu | awk -F: '/^L3 cache:/{gsub(/^[ \t]+/,"",$2); print $2}')
        # These sysfs entries depend on the kernel/cpufreq driver and may be
        # absent (e.g. VMs, containers, intel_pstate); record "" when missing.
        smt=$(cat /sys/devices/system/cpu/smt/active 2>/dev/null || true)
        scaling_governor=$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || true)
        boost=$(cat /sys/devices/system/cpu/cpufreq/boost 2>/dev/null || true)
        energy_performance_preference=$(cat /sys/devices/system/cpu/cpufreq/policy0/energy_performance_preference 2>/dev/null || true)
        max_freq_mhz=$(awk '{printf "%d", $1/1000}' /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq 2>/dev/null || true)
        # The active THP mode is the bracketed word, e.g. "always [madvise] never"
        thp=$(sed -n 's/.*\[\(.*\)\].*/\1/p' /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || true)
        thp_defrag=$(sed -n 's/.*\[\(.*\)\].*/\1/p' /sys/kernel/mm/transparent_hugepage/defrag 2>/dev/null || true)
        numa_balancing=$(cat /proc/sys/kernel/numa_balancing 2>/dev/null || true)
        zone_reclaim_mode=$(cat /proc/sys/vm/zone_reclaim_mode 2>/dev/null || true)
        mem_total_gb=$(awk '/^MemTotal:/{printf "%d", $2/1024/1024}' /proc/meminfo)
        # DIMM details come from SMBIOS; dmidecode needs root, so try it
        # directly (root run) then via passwordless sudo; record "" when
        # unavailable. Values are deduplicated across the installed DIMMs.
        dmi_mem=$( (dmidecode -t 17 || sudo -n dmidecode -t 17) 2>/dev/null || true)
        dimm_field () {
            awk -F': ' -v key="$1" '
                /^\tSize:/ { ok = ($0 !~ /No Module/) }
                ok && $1 == "\t" key { seen[$2] }
                END { s = ""; for (v in seen) s = s (s ? "," : "") v; print s }
            ' <<< "${dmi_mem}"
        }
        dimm_count=$(awk '/^\tSize:/ && $0 !~ /No Module/ {n++} END{print n+0}' <<< "${dmi_mem}")
        [[ -n "${dmi_mem}" ]] || dimm_count=""
        dimm_size=$(dimm_field "Size")
        mem_type=$(dimm_field "Type")
        mem_speed=$(dimm_field "Speed")
        mem_configured_speed=$(dimm_field "Configured Memory Speed")
    else
        sockets=1
        cores_per_socket=$(sysctl -n hw.ncpu)
        threads_per_core=1
        cpu_model=$(sysctl -n machdep.cpu.brand_string)
        smt=""
        scaling_governor=""
        boost=""
        energy_performance_preference=""
        max_freq_mhz=""
        numa_nodes=""
        l1d_cache=""
        l2_cache=""
        l3_cache=""
        thp=""
        thp_defrag=""
        numa_balancing=""
        zone_reclaim_mode=""
        mem_total_gb=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
        dimm_count=""
        dimm_size=""
        mem_type=""
        mem_speed=""
        mem_configured_speed=""
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
    TransparentHugePages: "${thp}"
    TransparentHugePagesDefrag: "${thp_defrag}"
    NumaBalancing: "${numa_balancing}"
  cpu:
    Arch: "${cpu_arch}"
    Model: "${cpu_model}"
    SocketNr: ${sockets}
    CoresPerSocket: ${cores_per_socket}
    ThreadsPerCore: ${threads_per_core}
    SimultaneousMultithreading: "${smt}"
    NumaNodeNr: "${numa_nodes}"
    L1dCache: "${l1d_cache}"
    L2Cache: "${l2_cache}"
    L3Cache: "${l3_cache}"
    FrequencyScaling:
        ScalingGovernor: "${scaling_governor}"
        Boost: "${boost}"
        EnergyPerformancePreference: "${energy_performance_preference}"
        MaxFreqMHz: "${max_freq_mhz}"
  memory:
    TotalGB: ${mem_total_gb}
    DIMMCount: "${dimm_count}"
    DIMMSize: "${dimm_size}"
    Type: "${mem_type}"
    Speed: "${mem_speed}"
    ConfiguredSpeed: "${mem_configured_speed}"
    ZoneReclaimMode: "${zone_reclaim_mode}"
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

# Check that every solution reports the same rowCount and columnCount for each
# table (master, trade, quote) in its stats.yaml. A mismatch means an engine
# loaded a different dataset, so its results would not be comparable.
function check_table_stats () {
    local files=()
    while IFS= read -r f; do
        files+=("$f")
    done < <(find "${RESULT_DIR}" -mindepth 2 -maxdepth 2 -type f -name 'stats.yaml' | sort)

    [[ ${#files[@]} -gt 0 ]] || return 0

    echo "Checking table stats consistency across ${#files[@]} stats.yaml file(s)..."
    awk '
        /^solution: /       { sol = substr($0, 11) }
        /^  name: /         { tbl = $2 }
        /^  rowCount: /     { check("rowCount", $2) }
        /^  columnCount: /  { check("columnCount", $2) }
        function check(what, val,    key) {
            key = tbl "/" what
            if (!(key in ref)) {
                ref[key] = val
                refsol[key] = sol
            } else if (ref[key] != val) {
                printf "WARNING: %s MISMATCH for table %s: %s reports %s but %s reports %s\n", \
                    toupper(what), tbl, sol, val, refsol[key], ref[key]
            }
        }
    ' "${files[@]}"
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
    check_table_stats

    echo "Benchmark suite complete."
    end_time=$(date +%s)

    local elapsed=$((end_time - start_time))

    echo "Benchmark completed successfully in $((elapsed / 86400))d $(date -u -d "@$((elapsed % 86400))" +%T)"
}
