#!/usr/bin/env bash
# Run one Rayforce layout/core-count benchmark and emit the same 20-column
# per-engine PSV contract as src/runQueries.q. The shared run_solution helper
# prepends the solution column later.
set -euo pipefail

RAYFORCE_BIN="${RAYFORCE_BIN:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/rayforce/rayforce}"
SELFDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDXFILTER=""
LAYOUT="grouped"
QUERY_OUTPUT_DIR=""
TABLE_STATS_DIR=""
THREAD_LABEL=""

usage() {
    cat >&2 <<'EOF'
usage: runRayforce.sh --db-dir DIR --param-dir DIR --datadate YYYYMMDD \
  --cores N --layout grouped|parted --queryfile FILE --querymeta FILE \
  -result FILE [-queryOutputDir DIR] [-tableStatsDir DIR] \
  [--thread-label N] [--idx FILTER]
EOF
    exit 2
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --db-dir)                       DB_DIR="$2"; shift 2 ;;
        --param-dir)                    PARAM_DIR="$2"; shift 2 ;;
        --datadate|--date|-date)        DATADATE="$2"; shift 2 ;;
        --cores)                        CORES="$2"; shift 2 ;;
        --thread-label)                 THREAD_LABEL="$2"; shift 2 ;;
        --layout)                       LAYOUT="$2"; shift 2 ;;
        --queryfile|-queryfile)         QUERYFILE="$2"; shift 2 ;;
        --querymeta|-querymeta)         QUERYMETA="$2"; shift 2 ;;
        --result|-result)               RESULT="$2"; shift 2 ;;
        --idx|-idx)                     IDXFILTER="$2"; shift 2 ;;
        --query-output-dir|-queryOutputDir)
                                          QUERY_OUTPUT_DIR="$2"; shift 2 ;;
        --table-stats-dir|-tableStatsDir)
                                          TABLE_STATS_DIR="$2"; shift 2 ;;
        -h|--help)                      usage ;;
        *) echo "runRayforce.sh: unknown option $1" >&2; usage ;;
    esac
done

for required in DB_DIR PARAM_DIR DATADATE CORES QUERYFILE QUERYMETA RESULT; do
    [[ -n "${!required:-}" ]] || {
        echo "runRayforce.sh: missing required option for ${required}" >&2
        usage
    }
done

THREAD_LABEL="${THREAD_LABEL:-${CORES}}"

[[ -x "${RAYFORCE_BIN}" ]] || {
    echo "runRayforce.sh: Rayforce binary not found: ${RAYFORCE_BIN}" >&2
    exit 1
}
[[ "${LAYOUT}" == "grouped" || "${LAYOUT}" == "parted" ]] || {
    echo "runRayforce.sh: --layout must be grouped or parted" >&2
    exit 2
}
[[ "${CORES}" =~ ^[1-9][0-9]*$ ]] || {
    echo "runRayforce.sh: --cores must be a positive integer" >&2
    exit 2
}
[[ "${DATADATE}" =~ ^[0-9]{8}$ ]] || {
    echo "runRayforce.sh: --datadate must be YYYYMMDD" >&2
    exit 2
}
[[ -d "${PARAM_DIR}" ]] || {
    echo "runRayforce.sh: parameter directory not found: ${PARAM_DIR}" >&2
    exit 1
}
[[ -r "${QUERYFILE}" ]] || {
    echo "runRayforce.sh: query file not found: ${QUERYFILE}" >&2
    exit 1
}
[[ -r "${QUERYMETA}" ]] || {
    echo "runRayforce.sh: query metadata file not found: ${QUERYMETA}" >&2
    exit 1
}

# Generation stores each date independently so a benchmark can never consume a
# stale Rayforce DB produced for a different --datadate value.
RAY_DATE_DIR="${DB_DIR}/rayforce/${DATADATE}"
if [[ ! -d "${RAY_DATE_DIR}/master" || ! -d "${RAY_DATE_DIR}/trade" || ! -d "${RAY_DATE_DIR}/quote" ]]; then
    echo "runRayforce.sh: Rayforce DB for ${DATADATE} not found at ${RAY_DATE_DIR}" >&2
    echo "Generate it with DATAFORMAT=rayforce before running this engine." >&2
    exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

if [[ -n "${QUERY_OUTPUT_DIR}" ]]; then
    mkdir -p "${QUERY_OUTPUT_DIR}"
fi
if [[ -n "${TABLE_STATS_DIR}" ]]; then
    mkdir -p "${TABLE_STATS_DIR}"
fi

# Parameter prelude (static exchange map plus generated per-size parameters).
cat "${SELFDIR}/prelude.rfl" > "${WORK}/params.rfl"
bash "${SELFDIR}/genParams.sh" "${PARAM_DIR}" >> "${WORK}/params.rfl"

# Join the query and metadata files positionally, validate their index/scope
# contract, and generate one driver row for every query. Filtered queries call
# skipq so they remain present in the result PSV as status=idxfiltered.
awk -F'|' -v flt="${IDXFILTER}" '
  function fail(msg) { print "runRayforce.sh: " msg > "/dev/stderr"; bad=1 }
  function keep(i,   a,n,j,lo,hi) {
    if (flt=="") return 1
    if (index(flt,",")) {
      n=split(flt,a,",")
      for (j=1;j<=n;j++) if (a[j]+0==i) return 1
      return 0
    }
    if (index(flt,"-")) {
      split(flt,a,"-"); lo=a[1]+0; hi=a[2]+0
      return i>=lo && i<=hi
    }
    return flt+0==i
  }
  FNR==NR {
    sub(/\r$/, "")
    if (FNR==1) {
      if ($1!="idx") fail("querymeta header must start with idx")
      next
    }
    m++
    midx[m]=$1
    mtags[m]=$2
    split($3,scope,":")
    if (scope[1]!="single" && scope[1]!="multi" && scope[1]!="all")
      fail("invalid instrument scope for metadata idx " $1 ": " $3)
    next
  }
  FNR==1 {
    sub(/\r$/, "")
    if ($1!="idx" || $2!="tags" || $3!="query")
      fail("query file header must be idx|tags|query|parameter")
    next
  }
  {
    sub(/\r$/, "")
    q++
    idx=$1
    if (q>m || idx!=midx[q]) {
      fail("index mismatch at query row " q ": query=" idx ", metadata=" midx[q])
      next
    }
    query=$3
    tags=$2
    if (mtags[q]!="") tags=(tags=="" ? mtags[q] : tags "," mtags[q])
    print ";; idx=" idx " tags=" tags
    if (substr(query,1,1)=="#")
      print "(skipq " idx " '\''skip)"
    else if (query=="")
      print "(skipq " idx " '\''emptyquery)"
    else if (!keep(idx+0))
      print "(skipq " idx " '\''idxfiltered)"
    else
      print "(runq " idx " " query ")"
  }
  END {
    if (q!=m) fail("query/querymeta row-count mismatch: query=" q ", metadata=" m)
    if (bad) exit 4
  }
' "${QUERYMETA}" "${QUERYFILE}" > "${WORK}/driver.rfl"

# Run the Rayfall harness. Its compact CSV is assembled into the suite PSV below.
RAY_DBDIR="${RAY_DATE_DIR}" \
RAY_PARAMS="${WORK}/params.rfl" \
RAY_DRIVER="${WORK}/driver.rfl" \
RAY_RESULT="${WORK}/machine.csv" \
RAY_LAYOUT="${LAYOUT}" \
RAY_QUERY_OUTPUT_DIR="${QUERY_OUTPUT_DIR}" \
RAY_TABLE_STATS="${TABLE_STATS_DIR:+${WORK}/table-stats.csv}" \
    "${RAYFORCE_BIN}" -c "${CORES}" "${SELFDIR}/runQueries.rfl" >&2

# Use the build string as the engine version, but strip PSV/CSV delimiters.
printf '(do (println (.sys.build)) (exit 0))\n' > "${WORK}/version.rfl"
EVERSION="$("${RAYFORCE_BIN}" -c 1 "${WORK}/version.rfl" 2>/dev/null | head -n1 | tr -d '\n' | tr '|,' '  ' || true)"
[[ -n "${EVERSION}" ]] || EVERSION="rayforce"

if [[ -n "${TABLE_STATS_DIR}" && -f "${WORK}/table-stats.csv" ]]; then
    awk -F',' '
      BEGIN { print "proprietary: '\''no'\''" }
      NR>1 {
        sub(/\r$/, "", $4)
        print $1 ":"
        print "  name: " $1
        print "  size (MB): " $2
        print "  rowCount: " $3
        print "  columnCount: " $4
      }
    ' "${WORK}/table-stats.csv" > "${TABLE_STATS_DIR}/stats.yaml"
fi

# Assemble the canonical 20-column per-engine PSV. Rayforce does not collect
# disk-I/O metrics, so those fields stay blank rather than claiming zero I/O.
mkdir -p "$(dirname "${RESULT}")"
awk -v ver="${EVERSION}" -v cores="${THREAD_LABEL}" -v layout="${LAYOUT}" '
  BEGIN { FS="|"; OFS="|" }
  FNR==NR {
    if (FNR>1 && $1!="") {
      qtext[$1]=$3
      sub(/^#/, "", qtext[$1])
    }
    next
  }
  FNR==1 && NR!=FNR {
    print "storagebackend","compparam","threadcount","runner","engine", \
          "format","sortcols","indexon","engineversion","idx","query", \
          "status","run1timeNS","run2timeNS","run3timeNS","run3memKB", \
          "run1ioKB","run2ioKB","run3ioKB","ressizeKB"
    next
  }
  {
    sub(/\r$/, "")
    n=split($0,c,",")
    idx=c[1]
    if (idx in qtext)       q=qtext[idx]
    else if (idx==0)        q="load date-specific splayed DB into RAM"
    else if (idx==-2)       q=(layout=="parted" ? "sort by sym,time" : "sort by time")
    else if (idx==-3)       q=(layout=="parted" ? "add parted index on sym" : "add grouped index on sym")
    else                    q="setup"
    print "memory","0_0_0",cores,"Rayforce","rayforce","rayforce", \
          (layout=="parted" ? "sym,time" : "time"),"sym",ver,idx,q,c[2], \
          c[3],c[4],c[5],c[6],"","","",c[7]
  }
' "${QUERYFILE}" "${WORK}/machine.csv" > "${RESULT}"

echo "Rayforce ${LAYOUT} results -> ${RESULT}" >&2
