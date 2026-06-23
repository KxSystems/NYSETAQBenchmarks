.logger:use`kx.log
.log:.logger.createLog[]

ko: key o: first each .Q.opt .z.x;

DB: o `db
DST: hsym `$o `dst

.log.info "loading kdb DB ", DB;
.Q.lo[`$DB;0;0]

symNr: count symFreq: first flip key asc select count i by sym from quote where date=min date

mostFreqInstr: last symFreq
.Q.dd[DST; `mostFreqInstr.txt] 0: enlist string mostFreqInstr

aFreqInstr: @[; floor 0.80 * count symFreq] symFreq;
.Q.dd[DST; `aFreqInstr.txt] 0: enlist string aFreqInstr

anInfreqInstr: @[; floor 0.2 * count symFreq] symFreq;
.Q.dd[DST; `anInfreqInstr.txt] 0: enlist string anInfreqInstr

twentyInstrs: -20?symFreq; / should be symbols of various quote counts to force different execution times
.Q.dd[DST; `twentyInstrs.txt] 0: string twentyInstrs

hundredInstrs: neg[symNr and 90]?symFreq;
hundredInstrs: 0N?hundredInstrs, (100-count hundredInstrs)?`4 / add some dummy instrument IDs
.Q.dd[DST; `hundredInstrs.txt] 0: string hundredInstrs

fivehundredInfreqInstrs: @[; (symNr-1) and til[490] + count[symFreq] div 10] symFreq; / many, but small quote count symbols
fivehundredInfreqInstrs: 0N?fivehundredInfreqInstrs, (500-count fivehundredInfreqInstrs)?`4 / add some dummy instrument IDs
.Q.dd[DST; `fivehundredInfreqInstrs.txt] 0: string fivehundredInfreqInstrs

/ time bucket lower bounds:
timeBuckets: ([closed: 0D; preopen: 0D04:00; open: 0D09:00; morning: 0D09:30; afternoon: 0D12:00; afterhours: 0D16; maintenance: 0D20])
.Q.dd[DST; `timeBuckets.txt] 0: "=" sv' flip (string[key timeBuckets]; -6_'string value timeBuckets)

exit 0