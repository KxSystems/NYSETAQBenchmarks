tb: use`kx.pq.t;
([pq]): use`kx.pq;

/ TODO: add error handling
loadHiveTable: {[res; dir]
  res cross $[all {x=key x} .Q.dd[dir] first c: key dir;
    ([] file: .Q.dd[dir] each c); [
    tmp: "S=;"0:";" sv string c;
    raze (enlist each flip enlist[tmp[0;0]]!enlist $[tmp[0;0]=`date;"D"$;`$] tmp 1) .z.s' .Q.dd[dir] each c
  ]]
  }

loadHiveDataset: {[db:`C; createmysym:`b]
  tNames: key hsym `$db;

  hiveTablesNames: tNames where not {all x=key x} each .Q.dd[hsym `$db] each tNames;
  tparts: loadHiveTable[enlist ()] each .Q.dd[hsym `$db] each hiveTablesNames;
  hiveTablesNames set' createmysym {[createmysym;x] tb.mkP ![x;(); 0b; enlist `file]!$[createmysym; {(`T!([t:(:{x,'([]mysym:`$x`9sym9min)})!])):x}; ::] each pq peach last flip x}' tparts;

  parquetTables: tNames except hiveTablesNames;
  (`$("." vs' string parquetTables)[;0]) set' pq each .Q.dd[hsym `$db] each parquetTables;
  }