//
// Export the trade & quote tables of a date-partitioned on-disk database to
// comma-separated CSV files that Rayforce can ingest with (read-csv ...).
//
// Rayforce ingests via CSV, so this script bridges from the generated on-disk
// database: it loads one partition into memory and writes only the columns the
// benchmark queries touch. The `time` column is emitted as I64 nanoseconds
// since midnight so Rayforce can do unambiguous integer comparisons /xbar.
//
// usage: q src/rayforce/exportRayCSV.q -db DB -date DATE -dst DSTDIR
//   -db   DB       database root (e.g. ${DB_DIR}/kdb)
//   -date DATE     partition date, e.g. 2026.04.01 or 20260401
//   -dst  DSTDIR   directory to write trade.csv and quote.csv into
//

if[(5.0>.z.K); -2 "5.0 runtime is required"; exit 1];

ko: key o: first each .Q.opt .z.x;
MANDATORY: `db`date`dst;
if[count missing: MANDATORY except ko;
  -2 "Missing mandatory parameter(s): ", ", " sv string missing; exit 1];

DB: hsym `$o `db;
D: "D"$o `date;
DST: o `dst;
system "mkdir -p ", DST;

// Load the whole HDB so the `sym` enumeration domain is present; without it the
// splayed sym columns read back as raw integer indices instead of symbol names.
// This also makes `trade`/`quote` date-partitioned tables with a virtual `date`.
system "l ", 1_string DB;

// Columns each Rayforce query needs (superset across all 52 queries).
TRADECOLS: `sym`time`price`size`stop`cond`ex`source`seq`corr;
QUOTECOLS: `sym`time`bid`ask`bsize`asize`cond`ex`source`seq`corr`shortSaleRestrictionIndicator;

loadPartition: {[db; d; tbl; keepCols]
  // functional select of the wanted columns from the partition for date d
  ?[tbl; enlist (=; `date; d); 0b; keepCols!keepCols] }

// `csv 0:` writes the char/string columns (ex, cond, stop, source, ssr) as
// plain text fields; Rayforce reads those columns back as SYMBOL. Only `time`
// (a timespan = nanoseconds within the day) needs coercing to a long so it
// lands as an I64 column in the CSV.
prepForCsv: {[t]
  if[`time in cols t; t: ![t; (); 0b; (enlist `time)!enlist (`long$; `time)]];
  t }

// Stream the CSV out in row-batches. Building the whole CSV in memory with a
// single `csv 0: t` blows the workspace on the 268M-row quote table, so we
// serialize `bs` rows at a time and drop the repeated header after the first
// batch.
// The `csv 0:` output object is capped at ~1GB; a 12-column batch of 6M rows
// serializes to ~370MB, comfortably under the limit.
BATCHROWS: 6000000;
save1: {[db; d; tbl; keepCols; dst; outname]
  -1 "Loading ", string tbl;
  t: prepForCsv loadPartition[db; d; tbl; keepCols];
  fn: hsym `$dst, "/", outname;
  n: count t;
  -1 "Writing ", (1_string fn), " (", string[n], " rows) in ", string[ceiling n % BATCHROWS], " batch(es)";
  h: hopen fn;
  {[h; t; n; i]
    st: i * BATCHROWS;
    lines: csv 0: t (st + til BATCHROWS & n - st);
    if[i > 0; lines: 1 _ lines];
    h raze lines ,\: "\n";
    }[h; t; n] each til ceiling n % BATCHROWS;
  hclose h; }

save1[DB; D; `trade; TRADECOLS; DST; "trade.csv"];
save1[DB; D; `quote; QUOTECOLS; DST; "quote.csv"];

-1 "Export complete.";
exit 0
