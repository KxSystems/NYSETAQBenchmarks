#!/bin/bash

# Populate the first column of one or more PSV files with 1,2,3,... (per-file).
# Usage: ./script.sh file1.psv file2.psv
#        ./script.sh *.psv

set -euo pipefail


if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <file.psv> [more_files.psv ...]" >&2
  exit 1
fi

# If a glob doesn't match, don't pass the literal pattern through.
shopt -s nullglob



for INPUT_FILE in "$@"; do
  if [[ ! -f "$INPUT_FILE" ]]; then
    echo "Skipping: '$INPUT_FILE' (not a regular file)" >&2
    continue
  fi


  OUTPUT_FILE=$(mktemp)
  # Preserve permissions from original file
  chmod --reference="$INPUT_FILE" "$OUTPUT_FILE" || true

  head -n 1 "$INPUT_FILE" > "$OUTPUT_FILE"
  tail -n +2 "$INPUT_FILE" | awk -F'|' -v OFS='|' '{$1 = NR; print}' >> "$OUTPUT_FILE"

  mv -f -- $OUTPUT_FILE $INPUT_FILE
done