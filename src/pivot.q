system "d .pvt"

// @kind function
// @fileoverview This general function returns the pivot of a table.
// It is a slight modification of the function available at https://code.kx.com/q/kb/pivoting-tables/
// modifications include: (1) `p` can be a scalar, (2) `t` can be a keyed table
// @param t {table} input keyed table
// @param k {symbol[]} key columns
// @param p {symbol[]} pivot columns
// @param v {symbol[]} value columns
// @param f {fn} a function of v and pivot values to name the new columns
// @param g {fn} a function of k, pivot values, and the return of f to order the new columns
// @returns {table} the pivoted table derived from the input table
piv: {[t;k;p;v;f;g]
 v:(),v;
 p:(),p;
 G:group flip k!(t: () xkey .Q.v t)k;
 F:group flip p!t p;
 count[k]!g[k;P;C]xcols 0!key[G]!flip(C:f[v]P:flip value flip key F)!raze
  {[i;j;k;x;y]
   a:count[x]#x 0N;
   a[y]:x y;
   b:count[x]#0b;
   b[y]:1b;
   c:a i;
   c[k]:first'[a[j]@'where'[b j]];
   c}[I[;0];I J;J:where 1<>count'[I:value G]]/:\:[t v;value F]
  };

// @kind function
// @fileoverview The default column name function in which the column names are the underscore separated pivot values.
getColNameFnDefault: {[v;P] `$"_" sv' string (v,()) cross P};

// @kind function
// @fileoverview The default column order function. The key columns first, then pivot columns in ascending order.
g: {[k;P;c] k,asc c};

// @kind function
// @fileoverview Function returns the pivot of a keyed table. The pivot column is the last key column
// and the value columns are the columns of the value of the keyed table.
// @param kt {keyed table} input keyed table
pivKT: {[kt] piv[kt; -1 _ cols key kt; last cols key kt; cols value kt; getColNameFnDefault; g]};


// @private
getColNameFn: {[l]
    if[11h ~ type l; :{[v;P] first each P}];
    if[0h ~ type l; :{[v;P] `$first each P}];           // probably strings
    :{[v;P] `$string first each P};                     // date, time, etc.
  };

// @kind function
// @fileoverview Function returns the pivot of a keyed table setting the pivot column to the last key column.
//
// Pass the output to [.Q.id](https://code.kx.com/q/ref/dotq/#qid-sanitize) to get sanitized column names if you would like to process the output in a safe way.
// @param kt {keyed table} input keyed table
// @returns {keyed table} the keyed table derived from the input table
// @example
// N: 1000;
//
// .pvt.pivot select sum v by date, p from
//      ([] date: N?.z.D + til 10; p: N?`1; v: N?10)
//
// .Q.id .pvt.pivot select sum v by k, d from
//      ([] k: N?`1; d: N?.z.D + til 5; v: N?10)
pivot: {[kt]
    piv[kt; -1 _ cols key kt; last cols key kt; first cols value kt;
        getColNameFn last value flip key kt; g]
  };

// @kind function
// @fileoverview Function returns the pivot table extended by a total column and a total row.
//
// @param fn {(dict) -> keyed table} an unary function that accepts a dictionary of groupbys and returns a keyed table. Typically, this is a projection of a functional select omitting the third parameter.
// @param grp {dict} dictionary of groupbys
// @param allname {symbol} name of the total column, e.g. `Total` or `All`
// @returns {keyed table} pivot table extended by total column and total row
// @example
// N: 1000;
// t: ([] date: N?.z.D + til 10; p: N?`1; v: N?10);
//
// .pvt.pivotWithTotalGen[
//    ?[t; (); ; enlist[`median_v]!enlist (med; `v)];
//    `date`p!`date`p; `Total]
pivotWithTotalGen: {[fn; grps; allname]
  data: pivot fn grps;
  tUpper: ((`$string key data)!value data) ,' allname xcol value fn -1 _ grps;   // upper part, key columns are converted to symbol
  tTotalCol: fn -1 # grps;                                                       // bottom excl. grand total
  tGrandTotal: fn 0b;                                                            // bottom right, i.e. grand total
  :tUpper, (enlist (-1 _ key grps)!(-1 + count grps)#allname)!(enlist first[value flip `$string key tTotalCol]!first value flip value tTotalCol) ,' allname xcol tGrandTotal
  };

// @kind function
// @fileoverview This function is a projection of pivotWithTotalGen setting the last parameter to `Total`
pivotWithTotal: pivotWithTotalGen[;; `Total];

system "d ."