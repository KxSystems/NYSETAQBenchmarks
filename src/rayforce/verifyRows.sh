#!/usr/bin/env bash
# Print "idx|rowcount" for each Rayforce query in a query PSV, for cross-checking
# query translations against a set of reference row counts.
# usage: verifyRows.sh DBDIR PARAMDIR DATADATE QUERYFILE [grouped|parted]
set -euo pipefail
if [[ $# -lt 4 || $# -gt 5 ]]; then
    echo "usage: verifyRows.sh DBDIR PARAMDIR DATADATE QUERYFILE [grouped|parted]" >&2
    exit 2
fi
DBDIR="$1"; PARAMDIR="$2"; DATADATE="$3"; QUERYFILE="$4"
LAYOUT="${5:-grouped}"
SELFDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAYFORCE_BIN="${RAYFORCE_BIN:-${SELFDIR}/../../../rayforce/rayforce}"
[[ "${DATADATE}" =~ ^[0-9]{8}$ ]] || { echo "invalid DATADATE: ${DATADATE}" >&2; exit 2; }
[[ "${LAYOUT}" == "grouped" || "${LAYOUT}" == "parted" ]] || { echo "invalid layout: ${LAYOUT}" >&2; exit 2; }
[[ -x "${RAYFORCE_BIN}" ]] || { echo "rayforce binary not found: ${RAYFORCE_BIN}" >&2; exit 1; }
RAY_DATE_DIR="${DBDIR}/rayforce/${DATADATE}"
[[ -d "${RAY_DATE_DIR}/master" && -d "${RAY_DATE_DIR}/trade" && -d "${RAY_DATE_DIR}/quote" ]] || {
    echo "Rayforce DB for ${DATADATE} not found: ${RAY_DATE_DIR}" >&2
    exit 1
}
WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT
cat "${SELFDIR}/prelude.rfl" > "${WORK}/params.rfl"
bash "${SELFDIR}/genParams.sh" "${PARAMDIR}" >> "${WORK}/params.rfl"
awk -F'|' 'NR>1 && $1!="" { print "(vq " $1 " " $3 ")" }' "${QUERYFILE}" > "${WORK}/driver.rfl"
RAY_DBDIR="${RAY_DATE_DIR}" RAY_PARAMS="${WORK}/params.rfl" RAY_DRIVER="${WORK}/driver.rfl" RAY_LAYOUT="${LAYOUT}" \
    "${RAYFORCE_BIN}" -c 4 "${SELFDIR}/verifyRows.rfl"
