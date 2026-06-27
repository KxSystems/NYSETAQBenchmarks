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
else
  echo "Generating kdb+ data (aka. HDB)..."
  QPATH="${QPATH:-}:${script_dir}/external:$(dirname "$(command -v q)")/../mod" q ./src/taqToKDB.q -date "$DATE" -src "$CSVDIR" -dst "$DST" -letters "$LETTERS" -s 4 -q
fi

