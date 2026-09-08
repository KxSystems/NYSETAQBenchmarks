loadRootObjectsIntoMemory: {[db: `s]
  .log.info "loading root objects into memory ";
  c: key db;
  files: c where ({x ~ key x} .Q.dd[db]@) each c;
  db {[db; f]
    .log.info "loading object ", string[f], " into memory";
    f set (get[.Q.dd[db;f]] ::)}' files;

  if[`exnames in key `.;
    .log.info "converting values of exnames to symbols";
    exnames:: `$exnames]
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
      / use symbols instead of enums agains global sym vector
      @[tName; where 20h=type each flip value tName; value];
      .log.info "Shape of ", string[tName], ": ", string[count value tName], " x ", string count cols tName; }' tbls;
    delete sym from `.;
  }; enlist])