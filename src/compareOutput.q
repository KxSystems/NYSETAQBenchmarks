// compareOutput.q
// -----------------------------------------------------------------------------
// Compares two sets of NYSE TAQ benchmark query outputs for equivalence.
//
// For every query listed in the metadata file, it loads the matching
// queryoutput_<idx>.csv from each of the two output directories and checks that
// they agree on:
//   - number of rows
//   - number of columns
//   - column names
// and then compares the content cell-by-cell. Floating-point columns are
// compared within FLOATDIFFTHREASHOLD with explicit null handling; all other
// types use exact match. The first mismatch per column is logged.
//
// Usage:
//   q compareOutput.q -querymeta <meta.psv> \
//                     -queryoutput1 <dir1> \
//                     -queryoutput2 <dir2> \
//                     [-idx FILTER] [-debug]
//
// Parameters:
//   querymeta     pipe-delimited query metadata (idx, tags, and sortby used)
//   queryoutput1  directory holding the first set of queryoutput_*.csv files
//   queryoutput2  directory holding the second set of queryoutput_*.csv files
//   idx           restrict the comparison to the given query indices: single
//                 (42), comma-separated list (32,42,50) or range (40-44)
//   debug         if set, keep the process alive after comparison (no exit)
//
// Exits 0 when all queries match; logs errors and continues per-query otherwise.
// -----------------------------------------------------------------------------

ko: key o: first each .Q.opt .z.x;

if[not all `querymeta`queryoutput1`queryoutput2 in ko;
    -2 "Missing parameter(s): ", "," sv string `querymeta`queryoutput1`queryoutput2 except ko;
    exit 1];

.logger:use`kx.log
.log:.logger.createLog[]

system "l src/util.q"

querymeta: ("J*****"; enlist "|")0: hsym `$o`querymeta / idx plus metadata used for canonical result ordering
if[`idx in ko;
    querymeta: select from querymeta where idx in parseIdxFilter o`idx];
if[not count querymeta;
    -2 "No queries matched the requested metadata/index filter";
    exit 1];
queryoutput1: hsym `$o`queryoutput1
queryoutput2: hsym `$o`queryoutput2

FLOATDIFFTHREASHOLD: 0.00005


tradeTypes: `time`ex`sym`cond`size`price`stop`corr`seq`tradeId`source`tradeReportingFacility`participantTimestamp`tradeReportingFacilityTRFTimestamp`tradeThroughExemptIndicator!"ncssieshijcsnnb"
quoteTypes: `time`ex`sym`bid`bsize`ask`asize`cond`seq`nationalBBOIndicator`finraBBOIndicator`finraADFMPIDIndicator`corr`source`retailInterestIndicator`shortSaleRestrictionIndicator`LULDBBOIndicator`SIPGeneratedMessageIdentifier`nationalBBOLULDIndicator`participantTimestamp`FINRAADFTimestamp`FINRAADFMarketParticipantQuoteIndicator`securityStatusIndicator!"ncseieiciccccccccccnncc"
/ The source kdb+ schema and Parquet schema differ only in acronym casing.
quoteTypes[`finraADFMpidIndicator]: first "c";
types: tradeTypes, quoteTypes, ([mid: "f"; avgLiqWMid: "f"]),
 ([avgSpread: "f"; avgWeightedSpread: "f"; devSpread: "f"; maxSpread: "e"; minSpread: "e"]),
 ([weightedBidPrice: "f"; weightedOfferPrice: "f"]),
 ([movingLiqWMid: "f"; movingsize: "f"; movingvwap: "f"; tag: "s"; seqDecr: "i"]),
 ([timeBucket: "s"; cnt: "j"]),
 ([o: "e"; h: "e"; l: "e"; c: "e"; s: "i"]),
 ([minute: "u"; inbal: "f"]),
 ([wsumAsk: "f"; wsumBid: "f"; sdevasksize: "f"; sdevbid: "f"; corPrice: "f"; corSize: "f"]),
 ([pricegroup: "i"; FirstTime: "n"; LastTime: "n"; medMidSize: "f"; medSize: "f"; quotecond: "c"; quoteex: "c"])

/ Fractional-share support changed trade size (and aggregates derived from it)
/ from int32 to float32. Keep both FINRA MPID spellings because the kdb+ source
/ schema and the Parquet schema currently differ only in acronym casing.
tradeTypes[`size]: first "e";
types[`size]: first "e";
types[`s]: first "e";

/ Rayforce persists timespans as nanosecond I64 values and writes booleans as
/ true/false, while q CSV writes temporal text and 0/1. Read these columns as
/ strings, then normalize both representations before comparison.
TEMPORALCOLS: `time`minute`FirstTime`LastTime`participantTimestamp`tradeReportingFacilityTRFTimestamp`FINRAADFTimestamp;
BOOLEANCOLS: enlist `tradeThroughExemptIndicator;
TEXTCOLS: `ex`cond`corr; / names/types differ between raw trade and quote schemas
SPECIALCOLS: TEMPORALCOLS, BOOLEANCOLS;
READASSTRINGCOLS: SPECIALCOLS, TEXTCOLS;

isIntegerText: {[x] (0<count x) and all x in "-0123456789"}
parseTemporalText: {[c; x]
    if[not count x; :0Nj];
    if[isIntegerText x; :"J"$x];
    if[c=`minute; :60000000000 * "j"$"U"$x];
    :"j"$"N"$x }
parseBooleanText: {[x]
    raw: raze string x;
    sx: `$lower raw;
    $[sx in `1`true`t; `true;
      sx in `0`false`f; `false;
      `$raw] }

csvTypes: {[cs]
    ts: "f"^types cs;
    @[ts; where cs in READASSTRINGCOLS; :; first "*"] }

normalizeSpecials: {[t]
    t: {[t; c] @[t; c; :; parseTemporalText[c] each t c]}/[t; TEMPORALCOLS inter cols t];
    t: {[t; c] @[t; c; :; parseBooleanText each t c]}/[t; BOOLEANCOLS inter cols t];
    t }

/ Use the declared comparison order to remove engine-specific group/hash order.
/ `idx is a virtual stable-row tiebreaker and timeBucketIdx names the concrete
/ timeBucket output column, so only materialized sort keys are applied here.
canonicalSort: {[t; sortby; tags]
    / Explicit sort queries must retain their emitted order. Re-sorting their
    / rounded q CSV floats against higher-precision engine CSV floats can split
    / apparent ties and manufacture row misalignment.
    if[`sort in `$"," vs tags; :t];
    if[not count sortby; :t];
    sc: `$"," vs sortby;
    sc: ?[sc=`timeBucketIdx; `timeBucket; sc];
    sc: sc inter cols t;
    $[count sc; sc xasc t; t] }

ERRORS: 0;

compare: {[idx: `j; tags: `C; instrument; description; sortby; comment]
    filename: `$"queryoutput_" , string[idx], ".csv";
    if[not filename in key queryoutput1;
        ERRORS::ERRORS+1;
        .log.error "Missing query output: ", string[filename], " from ", 1_string queryoutput1;
        :()];
    if[not filename in key queryoutput2;
        ERRORS::ERRORS+1;
        .log.error "Missing query output: ", string[filename], " from ", 1_string queryoutput2;
        :()];

    srct1: .Q.dd[queryoutput1; `$"queryoutput_" , string[idx], ".csv"];
    srct2: .Q.dd[queryoutput2; `$"queryoutput_" , string[idx], ".csv"];
    .log.info "Comparing tables with ", string[srct1], " and ", string srct2;
    t1cols: `$"," vs first read0 (srct1; 0; 65536);
    t2cols: `$"," vs first read0 (srct2; 0; 65536);
    t1: normalizeSpecials (csvTypes[t1cols]; enlist csv) 0: srct1;
    t2: normalizeSpecials (csvTypes[t2cols]; enlist csv) 0: srct2;

    if[ not count[t1] = count t2;
        ERRORS::ERRORS+1;
        .log.error "Different number of rows: ", string[count t1], " vs ", string count t2;
        :()];
    .log.info "Number of rows: \t\tOK";

    if[ not count[cols t1] = count cols t2;
        ERRORS::ERRORS+1;
        .log.error "Different number of columns: ", string[count cols t1], " vs ", string count cols t2;
        if[count missing: cols[t1] except cols t2;
            .log.error "Columns in ", (1_string srct1), " not in ", (1_string srct2), ": ", "," sv string missing];
        if[count missing: cols[t2] except cols t1;
            .log.error "Columns in ", (1_string srct2), " not in ", (1_string srct1), ": ", "," sv string missing];
        :()];
    .log.info "Number of columns: \tOK";


    if[ not (asc cols t1) ~ asc cols t2;
        ERRORS::ERRORS+1;
        .log.error "Different columns names: ", "," sv string cols[t1] except cols t2;
        :()];
    .log.info "Column names: \t\tOK";

    t2: cols[t1] xcols t2; / reorder columns to match t1
    t1: canonicalSort[t1; sortby; tags];
    t2: canonicalSort[t2; sortby; tags];

    errorsBefore: ERRORS;
    {[t1;t2;c]
        notok: not $[.Q.ty[t1 c] in "ef";
          (t1[c]~'t2 c) | ((not null t1 c) & (not null t2 c) & FLOATDIFFTHREASHOLD > abs t1[c] - t2 c);
          t1[c] ~' t2 c];
        if[any notok;
            ERRORS::ERRORS+1;
            idx: first where notok;
            .log.error "Column content differs: ", string c;
            .log.error "Differ in column ", string[c], " e.g. index ", string[idx], ": ", string[t1[idx;c]], " vs ", string[t2[idx;c]];
            ;();
        ]}[t1;t2] each cols t1;

    if[errorsBefore=ERRORS; .log.info "Content: \t\t\tOK"];
  }

(compare . value@) each querymeta;

if[ERRORS;
    .log.error string[ERRORS], " comparison error(s)";
    if[not `debug in key o; exit 1]];

if[not ERRORS; .log.info "ALL OK"];

if[not `debug in key o; exit 0];
