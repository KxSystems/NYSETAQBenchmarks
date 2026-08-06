// runQueries.lite.q -- docs/engine-contract.md implemented in the plain-q
// subset, for q implementations that are not KDB-X.
//
// src/runQueries.q is the reference implementation of the same contract and
// stays authoritative: same CLI, same PSV columns in the same order, same
// setup-row protocol, same three-run timing, same filter semantics and the
// same aborts. This file exists only because that one is written in q that a
// second implementation cannot parse -- KDB-X typed lambda parameters
// ({[x:`C] ...}) and progressive blocks inside a conditional ($[c;[a;b];...])
// are both parse errors elsewhere. It is meant to be deleted, not extended:
// when those parse, the qlite arm should run src/runQueries.q instead.
//
// It is memory-backend only. -format SPLAYED loads the splayed kdb database
// src/qengine/psvToSplayed.q writes, which is what makes the setup rows
// comparable with the kdb+ arms': both are then loading a kdb-format database.
// -format PSV parses the PSV files directly instead and needs no converter run,
// but its idx 0 row measures PSV parsing and is NOT comparable. Query rows are
// comparable either way, since the data is in memory by the time they run.

USAGE: "usage: q ", string[.z.f], " [-help] -db DB -paramdir DIR -queryfile FILE -querymeta FILE",
  " -storage_backend memory [-format (PSV|SPLAYED)] [-engine q-sql] [-sortcols COLS] [-indexon COL]",
  " [-date DATE] [-queryOutputDir DIR] [-result FILE] [-tableStatsDir DIR] [-tags TAGS]",
  " [-instrument (single|multi|all)] [-idx FILTER] [-debug]\n\n",
  "Loads one day of NYSE TAQ data into memory and runs the benchmark queries\n",
  "against it, writing the contract's per-query result PSV. -db is a splayed kdb\n",
  "database from src/qengine/psvToSplayed.q, or a directory of PSV files with\n",
  "-format PSV.\n\n",
  "See docs/engine-contract.md for the CLI, the result columns and the protocol."

// .Q.opt is documented to give each option a list of strings; take the first
// of it, tolerating an implementation that hands back the bare string.
ko: key o: {[v] $[10h ~ type v; v; count v; first v; ""]} each .Q.opt .z.x
opt: {[k] $[k in ko; o k; ""]}
if[`help in ko; -1 USAGE; exit 0]

MANDATORY: `db`paramdir`queryfile`querymeta`storage_backend
if[count missing: MANDATORY except ko;
  -2 "Missing mandatory parameter(s): ", ", " sv string missing;
  -2 "Run with -help for usage.";
  exit 1]

ALLOWED: MANDATORY,`format`engine`sortcols`indexon`date`queryOutputDir`result`tableStatsDir`tags`instrument`idx`debug
if[count unknown: ko except ALLOWED;
  -2 "Unknown parameter(s): ", ", " sv string unknown;
  -2 "Run with -help for usage.";
  exit 1]

STORAGE_BACKEND: lower opt `$"storage_backend"
if[not STORAGE_BACKEND ~ "memory";
  -2 "Unsupported storage backend ", STORAGE_BACKEND, " (this runner is memory only)"; exit 2]

if[not `date in ko; -2 "Date is required for inmemory tests"; exit 2]

if["" ~ getenv `FLUSH;
  -2 "Environment variable FLUSH is not set. Maybe config/queryenv was not loaded.";
  exit 2]

ENGINE: $[count e: opt `engine; `$e; `$"q-sql"]
if[not ENGINE ~ `$"q-sql"; -2 "Unsupported engine ", string ENGINE; exit 2]

\l src/pivot.q
\l src/memusage.q
\l src/loadPSVDataset.q
\l src/loadSplayedDataset.q
\l src/getQueryParameters.q

DB: opt `db
DATE: "D"$opt `date
PARAMDIR: hsym `$opt `paramdir
FORMAT: $[count f: upper opt `format; `$f; `SPLAYED]
if[not FORMAT in `PSV`SPLAYED;
  -2 "Unsupported format ", string[FORMAT], " (expected PSV or SPLAYED)"; exit 2]
LOADDATASET: $[FORMAT ~ `SPLAYED; loadSplayedDataset; loadPSVDataset]
INDEXON: trim lower opt `$"indexon"
SORTCOLS: (`$"," vs opt `sortcols) except `
QUERYOUTPUT: $[count d: opt `queryOutputDir; hsym `$d; `]

if[not count key hsym `$DB; -2 "Data directory ", DB, " does not exist"; exit 3]

checkInputFileExistence: {[f]
  fn: opt `$f;
  if[()~key hsym `$fn;
    -2 "File for -", f, " does not exist: ", fn; exit 3]}

checkInputFileExistence each ("queryfile"; "querymeta")

QueryTable: ("****"; enlist "|") 0: hsym `$opt `queryfile
QueryMetaTable: `idx`querytag`instrument xcol ("***"; enlist "|") 0: hsym `$opt `querymeta

if[not QueryTable[`idx] ~ QueryMetaTable`idx;
  -2 "Index mismatch between the query and the query meta files";
  exit 4]

// instrument is a base scope (single|multi|all) optionally refined with a
// frequency, e.g. "single:infrequent"; validate on the base before the colon.
INSTRUMENTBASES: ("single"; "multi"; "all")
if[not all {[bases; s] (first ":" vs s) in bases}[INSTRUMENTBASES] each QueryMetaTable `instrument;
  -2 "Missing or invalid instrument value in the query meta file (expected single, multi or all, optionally :<frequency>)";
  exit 4]

TagsFilter: {x except enlist ""} "," vs opt `tags
InstrumentFilter: trim opt `instrument
if[count[InstrumentFilter] and not InstrumentFilter in ("single"; "multi"; "all"; "single:infrequent"; "single:frequent"; "multi:50"; "multi:1000infreq");
  -2 "Invalid value for -instrument: ", InstrumentFilter, " (expected single, multi or all, optionally :<subscope>)";
  exit 2]

// src/util.q's parseIdxFilter uses a typed parameter and does not parse here.
parseIdx: {[s]
  if["," in s; :"J"$"," vs s];
  if["-" in s; b: "J"$"-" vs s; :b[0] + til 1 + b[1] - b[0]];
  enlist "J"$s}
IdxFilter: `long$()
if[`idx in ko; IdxFilter: parseIdx opt `idx]

// .Q.gc is not universal; a build without it just does not collect.
GC: {[] 0}
if[`gc in key `.Q; GC: .Q.gc]

IOStatError: `kB_read`kB_wrtn`kB_sum!3#0Nj
getKBReadLinux: {[device]
  r: @[system; "iostat -dk -o JSON ", device, " 2>&1"; {x}];
  if[not 0h ~ type r; :IOStatError];
  s: @[{[r] iostats: @[; `disk] first @[; `statistics] first first first value flip value .j.k raze r;
    if[not count iostats; '"empty"];
    m: exec `long$sum kB_read, `long$sum kB_wrtn from iostats;
    m, ([kB_sum: sum m])}; r; {x}];
  $[99h ~ type s; s; IOStatError]}
getKBRead: getKBReadLinux
if["false" ~ lower getenv `IOSTAT; getKBRead: {[device] IOStatError}]
if[not .z.o ~ `l64; getKBRead: {[device] IOStatError}]

resultH: `
if[`result in ko;
  -1 "saving results to ", opt `result;
  if[not ()~key `$resFile: ":", opt `result; hdel `$resFile];
  resultH: hopen resFile;
  resultH "storagebackend|compparam|threadcount|runner|engine|format|indexon|idx|query|status|run1timeNS|run2timeNS|run3timeNS|run3memKB|run1ioKB|run2ioKB|run3ioKB|ressizeKB\n"]

// The object-size estimator recurses through .z.s, which is not universal, so
// the result size of a table is genuinely uncollectable here. Report that
// rather than a zero, the way main.py reports uncollectable telemetry.
NYI: "nyi"
resSize: {[res] r: @[.mem.objsize; res; {x}]; $[-7h ~ type r; string r div 1024; NYI]}

SEP: "|"
COMPPARAM: "0_0_0"   / data is not compressed in memory

// A cell the runner did not measure is the empty one -- that is what
// src/runQueries.q emits and what convertToJSFormat.py parses. kdb+'s `string`
// renders a null long that way already; peachq renders it "0Nl", which reaches
// the dashboard converter as an unparsable timing.
nullStr: {[v] $[null v; ""; string v]}

writeRes: {[idx; query; status; ts; memusage; io; ressize]
  if[null resultH; :()];
  fixed: (STORAGE_BACKEND; COMPPARAM; string 1 | system "s"; "qlite"; string ENGINE;
    string lower FORMAT; INDEXON; idx; query; status);
  times: nullStr each `long$ 3 # ts, 3 # 0Nn;
  mem: $[10h ~ type memusage; memusage; nullStr memusage div 1000];
  ios: nullStr each 1 _ deltas 4 # io, 4 # 0Nj;
  resultH (SEP sv fixed, times, (enlist mem), ios, enlist ressize), "\n"}

flushCaches: {[] -1 raze system getenv[`FLUSH], " ", DB;}

setupRow: {[idx; desc; status; ts; memusage; io; ressize]
  writeRes[string idx; desc; status; ts; memusage; io; ressize]}

statusOf: {[timing] $[count e: timing 3; e; "success"]}

// Time f, returning (elapsed; bytes; kB_read before and after; "" or the error).
timed: {[f; args]
  io: (), getKBRead[Device] `kB_read;
  s: .z.p;
  r: .[.Q.ts; (f; args); {(0N 0N; x)}];
  e: .z.p;
  io,: getKBRead[Device] `kB_read;
  (e - s; last first r; io; $[10h ~ type last r; last r; ""])}

sortTradeQuoteTables: {[sortCols]
  {[sortCols; tName] -1 "sorting ", string[tName], " by ", "," sv string sortCols;
    sortCols xasc tName}[sortCols] each `trade`quote;}

addAttr: {[c; a]
  {[c; a; tName] ![tName; (); 0b; (enlist c)!enlist (a; c)]}[c; a] each `quote`trade;}

getAttrib: {[indexon; sortcols]
  if[indexon ~ ""; :(enlist `time)!enlist `#];
  if[indexon ~ "time"; :(enlist `time)!enlist `s#];
  if[indexon ~ "sym"; :(enlist `sym)!enlist $[`sym ~ first sortcols; `p#; `g#]];
  -2 "Unsupported indexon, sortcols combination";
  exit 6}

loadIntoMemory: {[db; date; sortCols; attrib]
  flushCaches[];
  GC[];
  -1 "loading ", lower string[FORMAT], " dataset at ", db;
  r: timed[LOADDATASET; (db; date)];
  setupRow[0; "load a partition into memory"; statusOf r; r 0; r 1; r 2; NYI];
  / no transformation, but we want to record the time and memory usage of the transformation step
  setupRow[-1; "transform"; "success"; 0D; 0j; 0j; NYI];

  if[count sortCols;
    r: timed[sortTradeQuoteTables; enlist sortCols];
    setupRow[-2; "sort"; statusOf r; r 0; r 1; r 2; NYI]];

  / an implementation without attributes must say so, not silently skip the step
  {[attrib; c]
    r: timed[addAttr; (c; attrib c)];
    setupRow[-3; "index"; statusOf r; r 0; r 1; r 2; NYI]}[attrib] each key attrib;}

captureTableStats: {[tableStatsDir]
  tableStatsFile: .Q.dd[tableStatsDir; `$"stats.yaml"];
  if[not ()~key tableStatsFile; hdel tableStatsFile];
  h: hopen tableStatsFile;
  h "proprietary: 'no'\n";
  h "engineversion: '", string[.z.K], " ", string[.z.k], "'\n";
  {[h; tName]
    t: value tName;
    h (string tName), ":\n";
    h "  name: ", (string tName), "\n";
    h "  size (MB): ", NYI, "\n";
    h "  rowCount: ", (string count t), "\n";
    h "  columnCount: ", (string count cols t), "\n";
    h "  columns: \n";
    {[h; t; c]
      ty: $[0h ~ type t c; `string; "s" ~ .Q.ty t c; `symbol; key t c];
      h "  - name: ", (string c), "\n";
      h "    type: ", (string ty), "\n";
      h "    attr: ", (string attr t c), "\n"}[h; t] each cols t}[h] each `master`trade`quote;
  h "sortcols: '", ("," sv string SORTCOLS), "'\n";
  hclose h}

persistOutput: {[dir; res; idx]
  if[` ~ dir; :()];
  if[not .Q.qt res: 0!res; '"result is not a table"];
  origCols: cols res;
  res: .Q.id res;
  m: 0! meta res;
  cs: flip res;
  / .Q.f does not accept every float type everywhere; where it does not, leave
  / the column for .h.cd to format.
  fmt6: {[c] $[10h ~ type r: @[{[c] .Q.f[6] each c}; c; {x}]; c; r]};
  cs: {[fmt6; cs; c] cs[c]: fmt6 cs c; cs}[fmt6]/[cs; m[`c] where m[`t] in "ef"];
  .Q.dd[dir; `$"queryoutput_", idx, ".csv"] 0: .h.cd origCols xcol flip cs;}

// Persisting the output is telemetry: a failure is worth a warning, not the
// loss of every query after it.
tryPersistOutput: {[dir; res; idx]
  e: @[{[a] persistOutput . a; ""}; (dir; res; idx); {x}];
  if[count e; -2 "[", idx, "] could not persist the query output: ", e];}

// A base filter (e.g. "single") matches its frequency variants too.
skipReason: {[idx; querytags; instrument]
  if["#" ~ first idx; :"skip"];
  if[count[IdxFilter] and not ("J"$idx) in IdxFilter; :"idxfiltered"];
  if[count[TagsFilter] and not any {[f; t] any f ~\: t}[TagsFilter] each querytags; :"tagfiltered"];
  if[count[InstrumentFilter] and not (instrument ~ InstrumentFilter) or InstrumentFilter ~ first ":" vs instrument;
    :"instrumentfiltered"];
  ""}

runQuery: {[idx; querytags; instrument; query]
  idx: trim idx;
  query: trim query;

  if[not count query; writeRes[idx; query; "emptyquery"; (); 0Nj; (); NYI]; :()];
  reason: skipReason[idx; querytags; instrument];
  if["skip" ~ reason; writeRes[1 _ idx; query; reason; (); 0Nj; (); NYI]; :()];
  if[count reason; writeRes[idx; query; reason; (); 0Nj; (); NYI]; :()];

  ts: io: ();
  flushCaches[];
  GC[];
  -1 "[", idx, "] Running query: ", query;
  io,: getKBRead[Device] `kB_read;
  s: .z.p;
  res: @[value; query; {x}];
  ts,: .z.p - s;
  if[10h ~ type res; writeRes[idx; query; res; (); 0Nj; (); NYI]; :()];
  io,: getKBRead[Device] `kB_read;
  -1 "[", idx, "]   Shape of the result: ", $[.Q.qt res; string[count res], " x ", string count cols res; "not a table"];
  tryPersistOutput[QUERYOUTPUT; res; idx];
  res: ();

  GC[];
  s: .z.p;
  res: @[value; query; {x}];
  ts,: .z.p - s;
  if[10h ~ type res; writeRes[idx; query; res; ts; 0Nj; io; NYI]; :()];
  io,: getKBRead[Device] `kB_read;
  res: ();

  GC[];
  s: .z.p;
  r: .[.Q.ts; (value; enlist query); {(0N 0N; x)}];
  ts,: .z.p - s;
  res: last r;
  if[10h ~ type res; writeRes[idx; query; res; ts; 0Nj; io; NYI]; :()];
  io,: getKBRead[Device] `kB_read;

  writeRes[idx; query; "success"; ts; last first r; io; resSize res];}

startTime: .z.p
Device: first system "./src/resolve_device.sh ", DB
-1 "Monitoring device ", Device

loadIntoMemory[DB; DATE; SORTCOLS; getAttrib[INDEXON; SORTCOLS]]

if[`tableStatsDir in ko; captureTableStats hsym `$opt `tableStatsDir]

-1 "Loading parameters from ", 1_string PARAMDIR
// A parameter this implementation cannot build must stay unset, so the queries
// that use it fail loudly instead of silently degrading to a wrong answer.
paramErr: @[{[d] getQueryParameters d; ::}; PARAMDIR; {x}]
if[10h ~ type paramErr;
  -2 "Not all query parameters could be built (", paramErr, "); queries using the missing ones will report an error"]

// The two files are row-aligned by idx, asserted above, so tags come from the
// engine-specific query file and querytag from the engine-independent meta.
QueryTags: {[a; b] {x except enlist ""} raze {"," vs x} each (a; b)} ' [QueryMetaTable `querytag; QueryTable `tags]
runQuery ' [QueryTable `idx; QueryTags; QueryMetaTable `instrument; QueryTable `query]

-1 "Query benchmark completed in ", 2_string .z.p - startTime
if[not `debug in ko; exit 0]
