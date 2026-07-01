#!/usr/bin/env bash

set -euo pipefail

script_dir=$(dirname "${BASH_SOURCE[0]}")
source "${script_dir}/external/kx/taq/scripts/util.sh"

readonly CSVDIR="$1"
readonly DST="$2"
check_date "$3"
readonly DATE="$3"


LETTERS=$(get_letters $SIZE)

if [[ ${DATAFORMAT} == "parquet" ]]; then
  echo "Generating parquet dataset..."
  uv run ./pysrc/taqToParquet/main.py -date "$DATE" -src "$CSVDIR" -dst "$DST" -letters "$LETTERS"
elif [[ ${DATAFORMAT} == "rayforce" ]]; then
  # Rayforce ingests via CSV, so it bridges through the generated on-disk DB:
  # export the needed trade/quote columns to comma-CSV, then build the native
  # splayed DB with .csv.splayed. Expects the on-disk DB to already exist at the
  # sibling 'kdb' directory of $DST.
  SRCDB="$(dirname "$DST")/kdb"
  RAYFORCE_BIN="${RAYFORCE_BIN:-${script_dir}/../rayforce/rayforce}"
  [[ -d "${SRCDB}" ]] || { echo "rayforce gen needs the source DB first: ${SRCDB} missing" >&2; exit 1; }
  [[ -x "${RAYFORCE_BIN}" ]] || { echo "rayforce binary not found: ${RAYFORCE_BIN}" >&2; exit 1; }
  RAYCSV="$(mktemp -d)"
  trap 'rm -rf "${RAYCSV}"' EXIT
  echo "Exporting trade/quote to CSV for Rayforce..."
  QPATH="${QPATH:-}:${script_dir}/external:$(dirname "$(command -v q)")/../mod" \
    q ./src/rayforce/exportRayCSV.q -db "${SRCDB}" -date "$DATE" -dst "${RAYCSV}" -q
  echo "Building Rayforce splayed DB..."
  RAY_CSVDIR="${RAYCSV}" RAY_DBDIR="${DST}" "${RAYFORCE_BIN}" -c 4 ./src/rayforce/buildRayforceDB.rfl
else
  echo "Generating kdb+ data (aka. HDB)..."
  QPATH="${QPATH:-}:${script_dir}/external:$(dirname "$(command -v q)")/../mod" q ./src/taqToKDB.q -date "$DATE" -src "$CSVDIR" -dst "$DST" -letters "$LETTERS" -s 4 -q
fi

