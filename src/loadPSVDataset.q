// Load one day of NYSE TAQ PSV files straight into the master/trade/quote
// tables and the exnames map, without building a kdb+ database first.
//
// The kdb+ path (src/taqToKDB.q -> kx.taq.taq) needs the KDB-X module system,
// so a q implementation without it has no way into the benchmark. This is the
// PSV equivalent of src/loadHiveDataset.q: it produces the same four objects
// runQueries.q expects, reusing the submodule's schemas so the column names,
// types and exchange-name map cannot drift from the kdb+ parser's.

\l external/kx/taq/taq/inputSchema.q

// "C" in 0: and $ is not universal; where it is missing the column is read as
// "*" and folded back to char, which yields the same 10h column.
PSVCHAR: not 10h ~ type @[{"C"$"x"}; ::; {x}]

psvRead: {[schema; rename; file]
  types: value schema;
  charCols: (key schema) where "C" = types;
  if[not PSVCHAR; types: ssr[types; "C"; "*"]];
  d: key[schema]!value flip (types; enlist "|") 0: file;
  if[not PSVCHAR; d: {[d; c] d[c]: first each d c; d}/[d; charCols]];
  rename xcol flip d
  }

// Whitespace is not valid in a kdb+ column name, so the kdb+ parser dots it out
// before symbolising; keep the two paths producing identical sym values.
psvSyms: {[s] `$ ssr[; " "; "."] each s}
psvSymbolConv: {[t] update sym: psvSyms sym from t}

psvQuoteFiles: {[src; datestr]
  files: key hsym `$src;
  q: files where (lower files) like "splits_us_all_bbo_?_", datestr, ".psv";
  $[count q; q; files where (lower files) like "eqy_us_all_bbo_", datestr, ".psv"]
  }

// getPSVs.sh downloads only the BBO files a SIZE needs, so the letters present
// in the quote filenames are exactly the letter range generateDB.sh was given.
psvLetters: {[quoteFiles]
  parts: "_" vs' upper string quoteFiles;
  $[all 6 = count each parts; raze parts[; 4]; ""]
  }

psvLetterFilter: {[letters; t] $[count letters; t where (first each t `sym) in letters; t]}

loadPSVDataset: {[src; date]
  datestr: string[date] except ".";
  quoteFiles: psvQuoteFiles[src; datestr];
  letters: psvLetters quoteFiles;
  path: {[src; f] hsym `$src, "/", f}[src];

  m: psvLetterFilter[letters] psvRead[MASTERSCHEMA; MASTERRENAME;
    path "EQY_US_ALL_REF_MASTER_", datestr, ".psv"];
  testSymbols: asc psvSyms exec sym from m where testFlag;
  master:: psvSymbolConv select from m where not testFlag;

  keep: {[testSymbols; t] select from t where not sym in testSymbols}[testSymbols];

  trade:: keep psvSymbolConv psvLetterFilter[letters] psvRead[TRADESCHEMA; TRADERENAME;
    path "EQY_US_ALL_TRADE_", datestr, ".psv"];

  quote:: keep psvSymbolConv raze psvRead[QUOTESCHEMA; QUOTERENAME] each
    path each string asc quoteFiles;

  exnames:: EXNAMES;
  }
