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
  # export the master/trade/quote columns to comma-CSV, then build the native
  # splayed DB with .csv.splayed. Each date is stored separately below $DST so
  # benchmark runs cannot accidentally read data generated for another date.
  # Expects the on-disk DB to already exist at the sibling 'kdb' directory.
  SRCDB="$(dirname "$DST")/kdb"
  RAYFORCE_BIN="${RAYFORCE_BIN:-${script_dir}/../rayforce/rayforce}"
  [[ -d "${SRCDB}" ]] || { echo "rayforce gen needs the source DB first: ${SRCDB} missing" >&2; exit 1; }
  [[ -x "${RAYFORCE_BIN}" ]] || { echo "rayforce binary not found: ${RAYFORCE_BIN}" >&2; exit 1; }
  RAYCSV="$(mktemp -d)"
  trap 'rm -rf "${RAYCSV}"' EXIT
  echo "Exporting master/trade/quote to CSV for Rayforce..."
  RAY_EXPORT_BATCH_ROWS="${RAY_EXPORT_BATCH_ROWS:-6000000}"
  QPATH="${QPATH:-}:${script_dir}/external:$(dirname "$(command -v q)")/../mod" \
    q ./src/rayforce/exportRayCSV.q -db "${SRCDB}" -date "$DATE" -dst "${RAYCSV}" \
      -batchrows "${RAY_EXPORT_BATCH_ROWS}" -q
  echo "Building Rayforce splayed DB..."
  RAYFORCE_BUILD_CORES="${RAYFORCE_BUILD_CORES:-1}"
  RAY_DATE_DIR="${DST}/${DATE}"
  mkdir -p "${RAY_DATE_DIR}"
  RAY_CSVDIR="${RAYCSV}" RAY_DBDIR="${RAY_DATE_DIR}" \
    "${RAYFORCE_BIN}" -c "${RAYFORCE_BUILD_CORES}" ./src/rayforce/buildRayforceDB.rfl
else
  echo "Generating kdb+ data (aka. HDB)..."
  QPATH="${QPATH:-}:${script_dir}/external:$(dirname "$(command -v q)")/../mod" q ./src/taqToKDB.q -date "$DATE" -src "$CSVDIR" -dst "$DST" -letters "$LETTERS" -s 4 -q
fi
