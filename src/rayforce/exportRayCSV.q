//
// Export the trade & quote tables of a date-partitioned on-disk database to
// comma-separated CSV files that Rayforce can ingest with (read-csv ...).
//
// Rayforce ingests via CSV, so this script bridges from the generated on-disk
// database: it loads one partition into memory and writes the complete trade
// and quote schemas. Timespan columns are emitted as I64 nanoseconds so
// Rayforce can do unambiguous integer comparisons /xbar without losing the
// source precision.
//
// usage: q src/rayforce/exportRayCSV.q -db DB -date DATE -dst DSTDIR -batchrows N
//   -db   DB       database root (e.g. ${DB_DIR}/kdb)
//   -date DATE     partition date, e.g. 2026.04.01 or 20260401
//   -dst  DSTDIR   directory to write trade.csv and quote.csv into
//   -batchrows N    maximum rows serialized in one CSV object
//

if[(5.0>.z.K); -2 "5.0 runtime is required"; exit 1];

ko: key o: first each .Q.opt .z.x;
MANDATORY: `db`date`dst`batchrows;
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

// q's default display precision is not round-trip safe for 32-bit floats.
// CSV serialization honors `P`, so use full precision to keep distinct trade
// prices distinct after Rayforce parses the bridge files.
system "P 17";

// Complete source schemas, excluding the virtual partition column `date.
// Keeping source order also makes `select from ...` outputs line up naturally
// with the other adapters.
TRADECOLS: `time`ex`sym`cond`size`price`stop`corr`seq`tradeId`source`tradeReportingFacility`participantTimestamp`tradeReportingFacilityTRFTimestamp`tradeThroughExemptIndicator;
QUOTECOLS: `time`ex`sym`bid`bsize`ask`asize`cond`seq`nationalBBOIndicator`finraBBOIndicator`finraADFMpidIndicator`corr`source`retailInterestIndicator`shortSaleRestrictionIndicator`LULDBBOIndicator`SIPGeneratedMessageIdentifier`nationalBBOLULDIndicator`participantTimestamp`FINRAADFTimestamp`FINRAADFMarketParticipantQuoteIndicator`securityStatusIndicator;
TIMESPANCOLS: `time`participantTimestamp`tradeReportingFacilityTRFTimestamp`FINRAADFTimestamp;

loadPartition: {[db; d; tbl; keepCols]
  // functional select of the wanted columns from the partition for date d
  ?[tbl; enlist (=; `date; d); 0b; keepCols!keepCols] }

// `csv 0:` writes the char/string columns (ex, cond, stop, source, ssr) as
// plain text fields; Rayforce reads those columns back as SYMBOL. Timespans
// are coerced to long so they land as nanosecond I64 columns in the CSV.
prepForCsv: {[t]
  if[`time in cols t;
    t: ![t; (); 0b; (enlist `time)!enlist (`long$; `time)]];
  if[`participantTimestamp in cols t;
    t: ![t; (); 0b; (enlist `participantTimestamp)!enlist (`long$; `participantTimestamp)]];
  if[`tradeReportingFacilityTRFTimestamp in cols t;
    t: ![t; (); 0b; (enlist `tradeReportingFacilityTRFTimestamp)!enlist (`long$; `tradeReportingFacilityTRFTimestamp)]];
  if[`FINRAADFTimestamp in cols t;
    t: ![t; (); 0b; (enlist `FINRAADFTimestamp)!enlist (`long$; `FINRAADFTimestamp)]];
  t }

// Stream the CSV out in row-batches. Building the whole CSV in memory with a
// single `csv 0: t` blows the workspace on the 268M-row quote table, so we
// serialize `bs` rows at a time and drop the repeated header after the first
// batch.
// The caller supplies the batch size because CSV row width and available q
// workspace vary by dataset. It affects only export chunking, never database
// contents or measured query execution.
BATCHROWS: "J"$o `batchrows;
if[BATCHROWS < 1; -2 "batchrows must be positive"; exit 1];
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
