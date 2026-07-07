// util.q
// -----------------------------------------------------------------------------
// Small helpers shared across the NYSE TAQ benchmark q scripts.
// Load with: system "l src/util.q"
// -----------------------------------------------------------------------------

// Parse an -idx query filter string into a list of longs. Accepts a single
// value ("42"), a comma-separated list ("32,42,50") or a range ("40-44").
parseIdxFilter: {[s:`C]
  if["," in s; :"J"$"," vs s]; / list
  if["-" in s;                 / range
    (s;e): "J"$"-" vs s;
    :s + til 1 + e - s];
  :enlist "J"$s                / single value
  }
