.logger:use`kx.log
.log:.logger.createLog[]
o: first each .Q.opt .z.x;

TINYLINENR:100;    / in tiny mode we only write 100 lines. Useful for testing
TINY: `tiny in key o;

compparam: o `compparam;
compparamOffset:$[(`encr in key o) and not "0_0_0" ~ compparam; [
    -1 "Loading encryption file ", o`encr;
    -36!@[; 0; hsym `$] ":" vs o`encr;
    0 16 0i];
    0 0 0i];
src: hsym `$$[`src in key o; o `src; "tq/zd0_0_0"];
dst: hsym `$$[`dst in key o; o `dst; "tq/zd"], ssr[compparam; " "; "_"];

eachpeach:$[`peach in key o; peach; each]


sd: src .Q.dd/ `$o `date`table;
td: dst .Q.dd/ `$o `date`table;
.log.info "compressing ", string[sd], " with ", compparam, " into ", string td;

preload: {[sd:`s; c:`s]
  .log.info "Preloading column ", string c;
  -23!$[TINY; TINYLINENR#;] get hsym .Q.dd[sd;c] / force it to memory to precisely measure write time. Make sure that the attributes are preserved.
  }

saveColumn: {[sd:`s; td:`s; compparam:`I; sync:`b; c:`s]
  input: preload[sd;c];
  tf: .Q.dd[td;c];
  .log.info "Start persisting column ", string c;
  s:.z.p;
  (tf, compparam) set input;
  m:.z.p;

  syncTime:0;
  if[sync;
    system "sync ", 1 _ string tf;
    syncTime: .z.p-m];

  c, `set, (`long$(m-s; syncTime)) div 1000*1000
  }

appendColumn: {[sd:`s; td:`s; compparam:`I; sync:`b; c:`s]
  input: preload[sd;c];
  ca: `$string[c], "_append";
  tf: .Q.dd[td;ca];
  .log.info "Start appending to column ", string ca;
  (tf, compparam) set 0#input;
  inputchunks: ("I"$ o`chunksize) cut input;
  s: .z.p;
  .[tf;();,;] each inputchunks;
  m: .z.p;
  appendSyncTime: 0;
  if[sync;
    system "sync ", 1 _ string tf;
    appendSyncTime: .z.p-m];

  c, `append, (`long$(m-s; appendSyncTime)) div 1000*1000
  }

columns: get .Q.dd[sd; `.d]
s: .z.p
times: eachpeach[saveColumn[sd; td; compparamOffset + "I"$"_" vs compparam; `synccol in key o]] columns
m: .z.p
e: $[`syncdir in key o; [system "sync ", (1_ string td); .z.p]; m]
.Q.dd[td; `.d] set columns
times,: (`$"*"),`set,(`long$(m-s;e-m)) div 1000 * 1000

if[`chunksize in key o;
  sa: .z.p;
  times,: eachpeach[appendColumn[sd; td; compparamOffset + "I"$"_" vs compparam; `synccol in key o]] columns;
  ma: .z.p;
  ea: $[`syncdir in key o; [system "sync ", (1_ string td); .z.p]; ma];
  times,: (`$"*"),`append,(`long$(ma-sa;ea-ma)) div 1000 * 1000]

if[`times in key o;
  .log.info "saving times";
  result: flip `table`date`compparam`encryption`column`mode`write`sync!flip (`$o`table; "D"$o`date;`$o`compparam;`encr in key o),/:times;
  (`$o `times) 0: "|" 0: result];

if[not `debug in key o; exit 0];