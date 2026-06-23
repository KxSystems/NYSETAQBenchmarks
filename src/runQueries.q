.logger:use`kx.log
.log:.logger.createLog[]

system "l src/pivot.q"    / This will be available as a KX module
system "l src/memusage.q" / This is also available as a DI module

if["" ~ getenv `FLUSH;
  .log.info "Environment variable FLUSH is not set. Maybe config/queryenv was not loaded.";
  exit 2]

ko: key o: first each .Q.opt .z.x;

DB: o `db
PARAMDIR: hsym `$o`paramdir
STORAGE_BACKEND: lower o `$"storage_backend"
INDEXON: trim lower o `$"indexon"
FORMAT: `$upper o `format
ENGINE: (`$"q-sql")^`$upper o `engine
SORTCOLS: `$"," vs o `sortcols
QUERYOUTPUT: hsym `$o `queryoutput

resultH: `
if[`result in key o;
  .log.info "saving results to ", o `result;
  if[not ()~key `$resFile: ":", o `result; hdel `$resFile];
  resultH: hopen resFile;
  resultH "storagebackend|compparam|threadcount|runner|engine|format|sortcols|indexon|engineversion|idx|tags|query|status|run1timeNS|run2timeNS|run3timeNS|run3memKB|run1ioKB|run2ioKB|run3ioKB|ressizeKB\n"]



QueryTable: ("****";enlist "|") 0: `$o `queryfile;
.log.info "Loading and executing queries from ", o `queryfile;
QueryMetaTable: `idx`querytag xcol ("**";enlist "|") 0: `$o `querymeta;

Tags: ("," vs o`tags) except enlist ""

parseIdxFilter: {[s:`C]
  if["," in s; :"J"$"," vs s]; / list
  if["-" in s;                 / range
    (s;e): "J"$"-" vs s;
    :s + til 1 + e - s];
  :enlist "J"$s                / single value
  }
(IdxFilter:`J): $[`idx in ko; parseIdxFilter o`idx; `long$()]

if[not lower[getenv `EACHPEACH] in (""; "each"; "peach");
  .log.error "Invalid value for EACHPEACH environment variable. Allowed values are '', 'each' or 'peach'.";
  exit 3];
EACHPEACH: $["" ~ getenv `EACHPEACH; each; value lower getenv `EACHPEACH];

IOStatError: `kB_read`kB_wrtn`kB_sum!3#0Nj

getKBReadMac: {[device:`C]
  if[device ~ enlist ""; :IOStatError];
  iostatcmd: "iostat -d -I ", device, " 2>&1"; // -I returns the MB read as last column
  r: @[system; iostatcmd; .log.error];
  if[not 0h ~ type r; :IOStatError];
  @[IOStatError;`kB_sum;:;1000*`long$"F"$l last where not "" ~/: l:" " vs last r]
  }

getKBReadLinux: {[device:`C]
  iostatcmd: "iostat -dk -o JSON ", device, " 2>&1";
  r: @[system; iostatcmd; .log.error];
  :$[0h ~ type r; [
  	iostats: @[; `disk] first @[; `statistics] first first first value flip value .j.k raze r;
  	$[count iostats; [m:exec `long$sum kB_read, `long$sum kB_wrtn from iostats;m,([kB_sum: sum m])]; IOStatError]];
	IOStatError]
  }

getKBRead: $["false" ~ lower getenv `IOSTAT; {[x] IOStatError}; .z.o ~ `m64; getKBReadMac; getKBReadLinux]

getIdx: {[idx] $[10h ~ type idx; idx; string idx]}

SEP: "|"
writeRes: {[h; (storagebackend:`C; compparm:`C; engine:`s; format:`s; sortcols:`S; attrib:`C); idx:getIdx; tags; query:`C; (status:`C; ts:`N; memusage:`j; io:`J; ressize:`j)]
  if[null h; :()];
  if[not 3 = count ts;
    .log.error "Three elapsed times are expected";
    ts: 3#ts];
  if[not 4 = count io;
    .log.error "Four IO numbers are expected";
    io: 4#io];
  runner: "KDB-X";
  engineversion: string[.z.K], ",", string .z.k;
  h ,[;"\n"] SEP sv (storagebackend; compparm; string system "s"; "KDB-X"; string engine; string lower format; "," sv string sortcols; attrib; engineversion; idx; "," sv tags; query; status), string (`long$ts), (memusage div 1000), (1 _ deltas io), ressize div 1024;
  }

loadParquetDB: {[db: `C; rowgroup: `b; device: `C; writerFN]
  system "l src/loadHiveDataset.q";

  .log.info raze system getenv[`FLUSH], " ", db;
  .log.info "Collecting garbage";
  .Q.gc[];

  io: ();
  .log.info "loading parquet dataset at ", db;
  io,: getKBRead[device]`kB_read;
  s: .z.p;
  memusage: last first .Q.ts[loadHiveDataset; (db; rowgroup)];
  ts: .z.p-s;
  io,: getKBRead[device]`kB_read;
  writerFN[0; enlist ""; "load/mmap DB"; ("success"; ts, 2#0Nn; memusage; io, 2#0Nj)];

  exnames:: exec ex!`$name from exnames; / convert back to a map
  }

/////////////////// functions for in-memory tests ///////////////////

captureTableStats: {[tableStatsDir:`s; tName]
  tableStatsFile: .Q.dd[tableStatsDir; `$string[tName], ".yaml"];
  if[not ()~key tableStatsFile; hdel tableStatsFile];

  h: hopen tableStatsFile;
  h "name: ", (string tName), "\n";
  h "size (MB): ", (string floor .mem.objsize[value tName] % 1024*1024), "\n";
  h "rowCount: ", (string count value tName), "\n";
  h "columnCount: ", (string count cols tName), "\n";
  h "columns: \n";
  {[h;tName;c]
    / enums stored as 'symbol'
    t: $[0h ~ type tName c; `string; "s" ~ .Q.ty tName c; `symbol; key tName c];
    h "  - name: ", (string c), "\n";
    h "    type: ", (string t), "\n";
    h "    attr: ", (string meta[tName][c;`a]), "\n";
    }[h; tName] each cols tName;
  hclose h
  }

loadRootObjectsIntoMemory: {[db: `s]
  .log.info "loading root objects into memory ";
  c: key db;
  files: c where ({x ~ key x} .Q.dd[db]@) each c;
  db {[db; f]
    .log.info "loading object ", string[f], " into memory";
    f set (get[.Q.dd[db;f]] ::)}' files;
  }

loadKDBDBIntoMemory: ('[{[params]
  (db: `s; d: `d): 2#params;
  tbls: `master`trade`quote;
  if[3=count params; tbls: params 2];

  loadRootObjectsIntoMemory[db];
  dpath: .Q.dd[db; d];
  .log.info "loading tables in partition ", string[d], " into memory";
  .Q.dd[dpath] {[getPath; tName]
      .log.info "loading table ", string[tName], " into memory";
      tName set select from get[getPath tName] where i>-1;
      .log.info "Shape of ", string[tName], ": ", string[count value tName], " x ", string count cols tName; }' tbls;
  }; enlist])

sortTradeQuoteTables: {[sortCols]
  sortCols {[sortCols; tName]
    .log.info "sorting ", string[tName], " by ", $[0<type sortCols; "," sv ;] string sortCols;
    sortCols xasc tName
    }/: `trade`quote;
  }

addAttr: {[c;a]
  {[c; a; tName]
    .log.info "Adding attribute ", string[a], " to ", string[c], " of ", string[tName];
    ![tName;(); 0b; (enlist c)!enlist (a; c)]
     }[c;a] each `quote`trade;
  }

loadKDBDBIntoMemoryTableDict: {[db: `s; d: `d]
  loadKDBDBIntoMemory[db;d;`master]; / TODO: can we skip this and convert to table dict right away?

  .Q.dd[db;d] {[dpath; tName]
    .log.info "loading table ", string[tName], " into memory in table dictionary format";
    mappedT: get .Q.dd[dpath; tName];
    syms: exec asc distinct sym from mappedT;
    tName set (`u#syms)!mappedT {[t;s] delete sym from update `s#time from select from t where sym=s}/: syms}' `trade`quote;
  }

loadKDBPartitionIntoMemory: {[db: `s; device: `C; writerFN; d: `d; sortCols:`S; attrib]
  .log.info "Loading kdb+ partition ", string[d], " into memory";
  io: (), getKBRead[device]`kB_read;
  s: .z.p;
  memusage: last first .Q.ts[loadKDBDBIntoMemory; (db;d)];
  ts: .z.p-s;
  io,: getKBRead[device]`kB_read;
  writerFN[0; enlist "load"; "load a partition into memory"; ("success"; ts, 2#0Nn; memusage; io, 2#0Nj; 0Nj)];

  if[count sortCols;
    io: (), getKBRead[device]`kB_read;
    s: .z.p;
    memusage: last first .Q.ts[sortTradeQuoteTables; enlist sortCols];
    ts: .z.p-s;
    io,: getKBRead[device]`kB_read;
    writerFN[-2; enlist "load"; "sort"; ("success"; ts, 2#0Nn; memusage; io, 2#0Nj; 0Nj)]];


    (key attrib) {[device;writerFN;c;a] io: (), getKBRead[device]`kB_read;
    s: .z.p;
    memusage: last first .Q.ts[addAttr; (c;a)];
    ts: .z.p-s;
    io,: getKBRead[device]`kB_read;
    writerFN[-3; enlist "load"; "index"; ("success"; ts, 2#0Nn; memusage; io, 2#0Nj; 0Nj)]}[device; writerFN]' attrib;
  };

loadKDBPartitionIntoMemoryTableDict: {[db: `s; device: `C; writerFN; d: `d]
  .log.info "Loading kdb+ partition ", string[d], " into memory";
  io: (), getKBRead[device]`kB_read;
  s: .z.p;
  memusage: last first .Q.ts[loadKDBDBIntoMemoryTableDict; (db; d)];
  ts: .z.p-s;
  io,: getKBRead[device]`kB_read;
  writerFN[0; enlist "load"; "load first partition into memory"; ("success"; ts, 2#0Nn; memusage; io, 2#0Nj; 0Nj)];
  }

/////////////////////////////////////////////////////////

loadKDBDB: {[db: `C; device: `C; writerFN]
  io: ();
  .log.info "loading kdb DB ", db;
  if["true" ~ lower getenv `QMAP; loadcmd,:";.Q.MAP[]"];
  io,: getKBRead[device]`kB_read;
  s: .z.p;
  memusage: last first .Q.ts[.Q.lo; (db; 0b; 0)];
  ts: .z.p-s;
  io,: getKBRead[device]`kB_read;

  if[`encr in ko;
    .log.info "Loading encryption file ", o`encr;
    -36!@[; 0; hsym `$] ":" vs o`encr];

  writerFN[0; enlist "load"; "load/mmap DB"; ("success"; ts, 2#0Nn; memusage; io, 2#0Nj; 0Nj)];
  }

persistOutput: {[dir; res; idx:`C]
  if[not null dir;
    outFile: .Q.dd[dir; `$"queryoutput_", idx, ".csv"];
    origCols: cols res;
    res: .Q.id res;
    floatingCols: exec c from meta[res] where t in "ef";
    res: ![res; (); 0b; floatingCols!(each; .Q.f[6]; ) each floatingCols];
    outFile 0: .h.cd origCols xcol res;
  ];
  }

runQuery: {[db: `C; device: `C; writerFN; tags; idx:`C; querytags; query:`C; parameter:`C]
  query: trim query;
  parameter: trim parameter;
  idx: trim idx;
  if[not count query;
    writerFN[idx; querytags; query; ("emptyquery"; 3#0Nn; 0Nj; 4#0Nj; 0Nj)];
    :()];
  if["#" ~ first idx;
    writerFN[1_idx; querytags; query; ("skip"; 3#0Nn; 0Nj; 4#0Nj; 0Nj)];
    :()];
  if[count[IdxFilter] and not ("J"$idx) in IdxFilter;
    writerFN[idx; querytags; query; ("idxfiltered"; 3#0Nn; 0Nj; 4#0Nj; 0Nj)];
    :()];
  if[count[tags] and 0 = count querytags inter tags;
    writerFN[idx; querytags; query; ("tagfiltered"; 3#0Nn; 0Nj; 4#0Nj; 0Nj)];
    :()];

  executor: $[ENGINE ~ `SQL; $[count parameter; .s.sp[; enlist value parameter]; .s.e]; value];
  ts: io: ();
  .log.info raze system getenv[`FLUSH], " ", db;
  .log.info "Collecting garbage";
  .Q.gc[];
  .log.info "[", idx, "] Running query: ", query;
  io,: getKBRead[device]`kB_read;
  s: .z.p; / \ts does not collect memory usage of the secondary threads
  res: @[executor; query; ::];
  e: .z.p;
  ts,: e-s;
  if[10h ~ type res;
    writerFN[idx; querytags; query; (res; 3#0Nn; 0Nj; 4#0Nj; 0Nj)];
    :()];
  io,: getKBRead[device]`kB_read;
  .log.info "[", idx, "]   Shape of the result: ", string[count res], " x ", string count cols res;
  persistOutput[QUERYOUTPUT; 0!res; idx];
  res:();

  .log.info "[", idx, "]   Collecting garbage";
  .Q.gc[];
  .log.info "[", idx, "] Running query again";
  s: .z.p;
  res: @[executor; query; ::];
  e: .z.p;
  ts,: e-s;
  if[10h ~ type res;
    writerFN[idx; querytags; query; (res; ts[0], 2#0Nn; 0Nj; io, 2#0Nj; 0Nj)];
    :()];
  io,: getKBRead[device]`kB_read;
  res:();

  .log.info "[", idx, "]   Collecting garbage";
  .Q.gc[];
  .log.info "[", idx, "] Running query third time";
  threadcount: system "s";
  $[threadcount < 2; [ / we can get memory usage only in single-threaded mode, otherwise set it to null
    s: .z.p;
    res: .[.Q.ts; (executor; enlist query); ::];
    e: .z.p;
    if[10h ~ type res;
      writerFN[idx; querytags; query; (res; ts, 0Nn; 0Nj; io, 0Nj; 0Nj)];
      :()];
    memusage: last first res;
    res: last res];
  [
    s: .z.p;
    res: @[executor; query; ::];
    e: .z.p;
    if[10h ~ type res;
      writerFN[idx; querytags; query; (res; ts[0], 2#0Nn; 0Nj; io, 2#0Nj; 0Nj)];
      :()];
    memusage: 0Nj]];
  ts,: e-s;
  io,: getKBRead[device]`kB_read;

  writerFN[idx; querytags; query; ("success"; ts; memusage; io; .mem.objsize res)];
  };

/ TODO: make this a bit more flexible
getAttrib: {[indexon; sortcols]
  if[indexon ~ ""; :([time: `#])];  / sort by time adds sorted attribute automaticaly
  if[indexon ~ "time"; :([time: `s#])];
  if[indexon ~ "sym"; :$[`sym ~ first sortcols; ([sym:`p#]); ([sym:`g#])]];
  .log.error "Unsupported indexon, sortcols combination";
  exit 6
  }

startTime: .z.p
Device: first system "./src/resolve_device.sh ", DB
.log.info "Monitoring device ", Device

$[STORAGE_BACKEND ~ "inmemory"; [
  if[not `date in ko;
      .log.error "Date column is required for INMEMORYNOATTR format";
      exit 5];
  compparm: "0_0_0"; / data is not compressed in memory
  WriterFN:: writeRes[resultH; (STORAGE_BACKEND; compparm; ENGINE; FORMAT; SORTCOLS; INDEXON)];
  $[FORMAT = `TABLEDICT; [
    / For now we only support a single table dicitonary format and attr is ignored
    loadKDBPartitionIntoMemoryTableDict[hsym `$DB; Device; WriterFN; "D"$o `date];
    normalize: {cnt: count each x; ([] sym: where cnt) ,' raze x}]; / convert table dictionary to normal table
   [
    attrib: getAttrib[INDEXON; SORTCOLS];
    loadKDBPartitionIntoMemory[hsym `$DB; Device; WriterFN; "D"$o `date; SORTCOLS; attrib]]
   ]];
  STORAGE_BACKEND ~ "ondisk";
    $[FORMAT like "PARQUET*"; [
      compparm: "nyi_nyi_nyi";
      WriterFN:: writeRes[resultH; (STORAGE_BACKEND; compparm; ENGINE; FORMAT; SORTCOLS; INDEXON)];
      loadParquetDB[DB; FORMAT ~ `PARQUET_ROWGROUP; Device; WriterFN]
    ]; FORMAT = `KDB; [
      compparmall: -21!hsym `$DB,"/",string[first key hsym `$DB],"/quote/sym";   // or assume that db dir name reflects compression
      compparm: $[count compparmall; "_" sv string @[;`logicalBlockSize`algorithm`zipLevel] compparmall; "0_0_0"];
      WriterFN:: writeRes[resultH; (STORAGE_BACKEND; compparm; ENGINE; FORMAT; SORTCOLS; INDEXON)];
      loadKDBDB[DB; Device; WriterFN]
    ]; [.log.error "Unknown format ", FORMAT; exit 1]]; [
    .log.error "Unknown storage backend ", STORAGE_BACKEND; exit 1]];

if[not FORMAT ~ `INMEMORYTABLEDICT;
  if[`tableStatsDir in ko; captureTableStats[hsym `$o `tableStatsDir] each `master`trade`quote]];

.log.info "Loading parameters from ", 1_string PARAMDIR
system "l src/getQueryParameters.q"
getQueryParameters PARAMDIR

if[ENGINE ~ `SQL;
  ([init]):use`kx.sql;
  init[];
  .s.F[`exnames]: .s.fx exnames;
  .s.F[`timebucketsstep]: .s.fx timeBucketsStep;
  timeBuckets: `bound xasc ([] bucket: key timeBuckets; bound: value timeBuckets);
  ]

if[not QueryTable[`idx] ~ QueryMetaTable`idx;
  .log.error "Index mismatch between the query and the query meta files";
  exit 4
  ]

queries: QueryTable lj `idx xkey QueryMetaTable;
queries: select idx, (except[;enlist ""] each "," vs' "," sv' flip (querytag; tags)), query, parameter from queries
(runQuery[DB; Device; WriterFN; Tags] . value@) each queries;

.log.info "Query benchmark completed in ", 2_string .z.p - startTime;
if[not `debug in key o; exit 0];