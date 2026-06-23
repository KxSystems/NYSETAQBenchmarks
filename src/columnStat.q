.logger:use`kx.log
.log:.logger.createLog[]

o: first each .Q.opt .z.x;
DB: o `db;

getEntropy:{p: %[; count x] count each group x; neg sum p * 2 xlog p}
getTypeNSize:{
  s: hcount x;
  t: $[10h ~ type first get x; `string; key get x];
  if[t ~ `string; s+:hcount `$string[x],"#"];
  (t;s)
  }

processTable:{[db:`C;d:`s;table:`s]
  .Q.gc[];
  .log.info "Processing table ", string table;
  path:.Q.dd[hsym `$db; d, table];
  column: get .Q.dd[path; `.d];
  cpath: .Q.dd[path] each column;
  (datatype;size): flip getTypeNSize each cpath;
  (unique;differnr;entropy): flip (count distinct@; sum differ@; getEntropy) @\:/: get each cpath;
  ([] table; date:d; column; datatype; size; unique; differnr; entropy)
  }

result: raze (processTable[DB].) each except[key hsym `$DB; `sym] cross `$"," vs o`tables
.log.info "saving results";
(`$o `result) 0: "|" 0: result;

if[not `debug in key o; exit 0];