#!/usr/bin/env bash
# Print "idx|rowcount" for each Rayforce query in a query PSV, for cross-checking
# query translations against a set of reference row counts.
# usage: verifyRows.sh DBDIR PARAMDIR QUERYFILE
set -euo pipefail
DBDIR="$1"; PARAMDIR="$2"; QUERYFILE="$3"
SELFDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RAYFORCE_BIN="${RAYFORCE_BIN:-${SELFDIR}/../../../rayforce/rayforce}"
WORK="$(mktemp -d)"; trap 'rm -rf "${WORK}"' EXIT
cat "${SELFDIR}/prelude.rfl" > "${WORK}/params.rfl"
bash "${SELFDIR}/genParams.sh" "${PARAMDIR}" >> "${WORK}/params.rfl"
awk -F'|' 'NR>1 && $1!="" { print "(vq " $1 " " $3 ")" }' "${QUERYFILE}" > "${WORK}/driver.rfl"
RAY_DBDIR="${DBDIR}/rayforce" RAY_PARAMS="${WORK}/params.rfl" RAY_DRIVER="${WORK}/driver.rfl" \
    "${RAYFORCE_BIN}" -c 4 "${SELFDIR}/verifyRows.rfl"
