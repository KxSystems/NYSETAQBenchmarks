USAGE: "usage: q ", string[.z.f], " [-help] -db DB -dst DST\n\n",
  "Generates benchmark query parameter files from a kdb+ database. Reads the quote\n",
  "table for the earliest date and derives sets of instrument symbols (most/least\n",
  "frequent, random samples of various sizes) plus time buckets, writing one .txt\n",
  "file per parameter into the destination directory.\n\n",
  "Required options:\n",
  "  -db DB    kdb+ database directory to load (must exist)\n",
  "  -dst DST  Directory to write the generated parameter files to\n"

ko: key o: first each .Q.opt .z.x;
if[`help in ko; -1 USAGE; exit 0]

MANDATORY: `db`dst;
if[count missing: MANDATORY except ko;
  -2 "Missing mandatory parameter(s): ", ", " sv string missing;
  -2 "Run with -help for usage.";
  exit 1]

DB: o `db
DST: hsym `$o `dst

if[()~key hsym `$DB;
  -2 "Input database directory does not exist (or is empty): ", DB;
  -2 "Run with -help for usage.";
  exit 1]


.logger:use`kx.log
.log:.logger.createLog[]

.log.info "loading kdb DB ", DB;
.Q.lo[`$DB;0;0]

symNr: count symFreq: first flip key asc select count i by sym from quote where date=min date


freqInstr: last symFreq
.Q.dd[DST; `freqInstr.txt] 0: enlist string freqInstr

infreqInstr: @[; floor 0.2 * count symFreq] symFreq;
.Q.dd[DST; `infreqInstr.txt] 0: enlist string infreqInstr


fiftyInstrs: neg[symNr and 45]?symFreq;
fiftyInstrs: 0N?fiftyInstrs, (50-count fiftyInstrs)?`4 / add some dummy instrument IDs
.Q.dd[DST; `fiftyInstrs.txt] 0: string fiftyInstrs

thousandInfreqInstrs: @[; (symNr-1) and til[980] + count[symFreq] div 10] symFreq; / many, but small quote count symbols
thousandInfreqInstrs: 0N?thousandInfreqInstrs, (1000-count thousandInfreqInstrs)?`4 / add some dummy instrument IDs
.Q.dd[DST; `thousandInfreqInstrs.txt] 0: string thousandInfreqInstrs

/ time bucket lower bounds:
timeBuckets: ([closed: 0D; preopen: 0D04:00; open: 0D09:00; morning: 0D09:30; afternoon: 0D12:00; afterhours: 0D16; maintenance: 0D20])
.Q.dd[DST; `timeBuckets.txt] 0: "=" sv' flip (string[key timeBuckets]; -6_'string value timeBuckets)

if[not `debug in key o; exit 0];