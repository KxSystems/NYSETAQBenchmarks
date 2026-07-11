#!/usr/bin/env bash
#
# Run the Rayforce in-memory benchmark for one core count and emit a per-engine
# result PSV in the exact 21-column schema that src/runQueries.q writes, so the
# queryEngines.sh add_nickname + merge steps treat it like any other engine.
#
# It generates the Rayfall parameter prelude and query driver, invokes the
# Rayforce runner (src/rayforce/runQueries.rfl), then joins the runner's compact
# machine-CSV (idx,status,timings,mem,size) with the query text/tags and the
# constant columns.
#
# usage: runRayforce.sh --db-dir DIR --param-dir DIR --date DATE --cores N \
#                       --layout grouped|parted --queryfile FILE --result FILE \
#                       [--thread-label N] [--idx FILTER] [--query-output-dir DIR]
set -euo pipefail

RAYFORCE_BIN="${RAYFORCE_BIN:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)/rayforce/rayforce}"
SELFDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IDXFILTER=""
LAYOUT="grouped"
QUERY_OUTPUT_DIR=""
THREAD_LABEL=""

while [[ $# -gt 0 ]]; do
    case $1 in
        --db-dir)     DB_DIR="$2"; shift 2 ;;
        --param-dir)  PARAM_DIR="$2"; shift 2 ;;
        --date)       DATE="$2"; shift 2 ;;
        --cores)      CORES="$2"; shift 2 ;;
        --thread-label) THREAD_LABEL="$2"; shift 2 ;;
        --layout)     LAYOUT="$2"; shift 2 ;;
        --queryfile)  QUERYFILE="$2"; shift 2 ;;
        --result)     RESULT="$2"; shift 2 ;;
        --idx)        IDXFILTER="$2"; shift 2 ;;
        --query-output-dir) QUERY_OUTPUT_DIR="$2"; shift 2 ;;
        *) echo "runRayforce.sh: unknown option $1" >&2; exit 1 ;;
    esac
done

THREAD_LABEL="${THREAD_LABEL:-${CORES}}"

[[ -x "${RAYFORCE_BIN}" ]] || { echo "rayforce binary not found: ${RAYFORCE_BIN}" >&2; exit 1; }
[[ "${LAYOUT}" == "grouped" || "${LAYOUT}" == "parted" ]] || {
    echo "runRayforce.sh: --layout must be grouped or parted" >&2; exit 1;
}

WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

if [[ -n "${QUERY_OUTPUT_DIR}" ]]; then
    mkdir -p "${QUERY_OUTPUT_DIR}"
fi

# ---- parameter prelude (static exchange map + generated per-size params) ----
cat "${SELFDIR}/prelude.rfl" > "${WORK}/params.rfl"
bash "${SELFDIR}/genParams.sh" "${PARAM_DIR}" >> "${WORK}/params.rfl"

# ---- query driver: one (runq idx (fn [] <query>)) per selected row ----------
# Optional --idx filter (single / comma-list / lo-hi range), applied here so
# Rayforce only executes the requested queries.
awk -F'|' -v flt="${IDXFILTER}" '
  function keep(i,   a,n,j,lo,hi) {
    if (flt=="") return 1;
    if (index(flt,",")) { n=split(flt,a,","); for(j=1;j<=n;j++) if(a[j]+0==i) return 1; return 0; }
    if (index(flt,"-")) { split(flt,a,"-"); lo=a[1]+0; hi=a[2]+0; return (i>=lo && i<=hi); }
    return (flt+0==i);
  }
  NR>1 && $1!="" && keep($1+0) { print "(runq " $1 " " $3 ")" }
' "${QUERYFILE}" > "${WORK}/driver.rfl"

# ---- run ----
RAY_DBDIR="${DB_DIR}/rayforce" \
RAY_PARAMS="${WORK}/params.rfl" \
RAY_DRIVER="${WORK}/driver.rfl" \
RAY_RESULT="${WORK}/machine.csv" \
RAY_LAYOUT="${LAYOUT}" \
RAY_QUERY_OUTPUT_DIR="${QUERY_OUTPUT_DIR}" \
    "${RAYFORCE_BIN}" -c "${CORES}" "${SELFDIR}/runQueries.rfl" >&2

printf '(do (println (.sys.build)) (exit 0))\n' > "${WORK}/ver.rfl"
EVERSION="$("${RAYFORCE_BIN}" -c 1 "${WORK}/ver.rfl" 2>/dev/null | head -n1 | tr -d '\n' | tr '|,' '  ' || true)"
[[ -n "${EVERSION}" ]] || EVERSION="rayforce"

# ---- assemble the 21-column per-engine PSV ----------------------------------
# machine.csv:   idx,status,run1timeNS,run2timeNS,run3timeNS,run3memKB,ressizeKB
# QUERYFILE:     idx|tags|query|parameter   (pipe; Rayfall has no '|')
mkdir -p "$(dirname "${RESULT}")"
awk -v ver="${EVERSION}" -v cores="${THREAD_LABEL}" -v layout="${LAYOUT}" '
  BEGIN { FS="|"; OFS="|" }
  # query text + tags keyed by idx, from the pipe-delimited query file
  FNR==NR {
    if (FNR>1 && $1!="") { qtext[$1]=$3; qtags[$1]=$2 }
    next
  }
  # machine.csv rows (comma)
  FNR==1 && NR!=FNR {
    print "storagebackend","compparam","threadcount","runner","engine","format", \
          "sortcols","indexon","engineversion","idx","tags","query","status", \
          "run1timeNS","run2timeNS","run3timeNS","run3memKB", \
          "run1ioKB","run2ioKB","run3ioKB","ressizeKB"
    next
  }
  {
    n=split($0,c,",");
    idx=c[1]; status=c[2]; r1=c[3]; r2=c[4]; r3=c[5]; mem=c[6]; rsz=c[7];
    tags=(idx in qtags)?qtags[idx]:"load";
    if (idx in qtext)      { q=qtext[idx] }
    else if (idx==0)       { q="load splayed DB (mmap)"; tags="load" }
    else if (idx==-2)      { q=(layout=="parted" ? "sort by sym,time (materialize into RAM)" : "sort by time (materialize into RAM)"); tags="load" }
    else if (idx==-3)      { q=(layout=="parted" ? "add parted index on sym" : "add grouped index on sym"); tags="load" }
    else                   { q="setup" }
    print "memory","0_0_0",cores,"Rayforce","rayforce","rayforce", \
          (layout=="parted" ? "sym,time" : "time"),"sym",ver,idx,tags,q,status, \
          r1,r2,r3,mem,0,0,0,rsz
  }
' "${QUERYFILE}" "${WORK}/machine.csv" > "${RESULT}"

echo "Rayforce ${LAYOUT} results -> ${RESULT}" >&2
