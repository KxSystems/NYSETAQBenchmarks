// psvToSplayed.q -- parse one day of NYSE TAQ PSV files into a splayed kdb
// database: DST/sym, DST/exnames and DST/<date>/{master,trade,quote}/.
//
// src/taqToKDB.q is the kdb+ equivalent and stays authoritative for the
// date-partitioned database the KDB-X arms read. It cannot serve a second q
// implementation: it is written against the KDB-X module system
// (use `kx.taq.taq) and typed lambda parameters, and neither parses elsewhere.
// This is the same job in the plain-q subset -- no modules, no typed
// parameters, no partitioning -- so that the qlite arm can load a kdb-format
// database instead of parsing PSVs, and its setup rows measure what the kdb+
// arms' setup rows measure.
//
// The <date> directory makes a database hold more than one day without runs
// reading each other's data. It is not a kdb+ partition: there is no par.txt,
// nothing is loaded as a partitioned view, and the loader reads each splay by
// path. The in-memory suite runs one date at a time, so that is enough.
//
// The whole day is held in memory before it is written, as parsing does
// already; src/taqToKDB.q's -batchsize has no equivalent here.

USAGE: "usage: q ", string[.z.f], " [-help] -src SRC -dst DST -date DATE [-debug]\n\n",
  "Parses one day of NYSE TAQ PSV files into a splayed kdb database at DST.\n\n",
  "The letter range comes from the BBO filenames present in SRC, so the database\n",
  "holds exactly the symbols getPSVs.sh downloaded -- there is no -letters option."

ko: key o: {[v] $[10h ~ type v; v; count v; first v; ""]} each .Q.opt .z.x
opt: {[k] $[k in ko; o k; ""]}
if[`help in ko; -1 USAGE; exit 0]

MANDATORY: `src`dst`date
if[count missing: MANDATORY except ko;
  -2 "Missing mandatory parameter(s): ", ", " sv string missing;
  -2 "Run with -help for usage.";
  exit 1]

ALLOWED: MANDATORY,`debug
if[count unknown: ko except ALLOWED;
  -2 "Unknown parameter(s): ", ", " sv string unknown;
  -2 "Run with -help for usage.";
  exit 1]

\l src/loadPSVDataset.q

SRC: opt `src
DST: hsym `$opt `dst
DATE: "D"$opt `date
if[null DATE; -2 "Invalid -date, expected YYYYMMDD: ", opt `date; exit 2]
if[not count key hsym `$SRC; -2 "Source directory ", SRC, " does not exist"; exit 3]

startTime: .z.p
-1 "parsing PSV files in ", SRC
loadPSVDataset[SRC; DATE]

// Every table is enumerated against the one sym domain at DST, so they have to
// be written one at a time rather than in parallel.
DPATH: .Q.dd[DST; DATE]
{[tName]
  -1 "writing ", string[tName], " (", string[count value tName], " rows)";
  .Q.dd[DPATH; `$string[tName], "/"] set .Q.en[DST; value tName];
  } each `master`trade`quote

.Q.dd[DST; `exnames] set exnames

-1 "wrote splayed database at ", (1 _ string DST), " in ", 2 _ string .z.p - startTime
if[not `debug in ko; exit 0]
