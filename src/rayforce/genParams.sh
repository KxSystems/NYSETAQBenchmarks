#!/usr/bin/env bash
#
# Generate a Rayfall prelude that binds the benchmark query-parameter globals
# from a parameter directory (artifacts/parameters/${SIZE}), mirroring
# src/getQueryParameters.q. Emits `set` forms for the instrument symbol(s) and
# the time-bucket bounds/names to stdout.
#
# usage: genParams.sh PARAMDIR > params.rfl

set -euo pipefail
PARAMDIR="$1"

emit_sym() {   # single-symbol param -> (set NAME 'VALUE)
    local name="$1" file="${PARAMDIR}/$2"
    local v; v="$(head -n1 "${file}" | tr -d '[:space:]')"
    printf "(set %s '%s)\n" "${name}" "${v}"
}

emit_symvec() { # symbol-list param -> (set NAME ['A 'B ...])
    local name="$1" file="${PARAMDIR}/$2"
    printf "(set %s [" "${name}"
    awk 'NF{printf "%s'\''%s", (NR>1?" ":""), $1}' "${file}"
    printf "])\n"
}

emit_sym    freqInstr              freqInstr.txt
emit_sym    infreqInstr            infreqInstr.txt
emit_symvec fiftyInstrs            fiftyInstrs.txt
emit_symvec thousandInfreqInstrs   thousandInfreqInstrs.txt

# timeBuckets: "name=0DHH:MM:SS.mmm" -> ns-since-midnight bounds + names.
awk -F'=' '
  NF==2 {
    name=$1; t=$2;
    sub(/^0D/, "", t);                       # strip 0D
    split(t, hms, ":"); split(hms[3], sec, ".");
    ns = (hms[1]*3600 + hms[2]*60 + sec[1])*1000000000 + (sec[2]+0)*1000000;
    n++;
    names[n]=name; bounds[n]=ns;
  }
  END {
    printf "(set tbNames [";  for(i=1;i<=n;i++) printf "%s'"'"'%s", (i>1?" ":""), names[i]; printf "])\n";
    printf "(set tbBounds ["; for(i=1;i<=n;i++) printf "%s%.0f",           (i>1?" ":""), bounds[i]; printf "])\n";
  }' "${PARAMDIR}/timeBuckets.txt"
