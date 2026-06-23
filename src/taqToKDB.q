//
// Script to parse NYSE TAQ PSV files, transform data
// and persist to a date-partitioned kdb+ database.
//
// Environment variables:
//   Compression related parameters: https://code.kx.com/q/kb/file-compression/#compression-parameters
//    LOGICAL_BLOCK_SIZE    Logical block size for the compression
//    COMPRESSION           Compression algorithm to be used when persisting data, e.g. ZSTD
//    COMPRESSION_LEVEL     Level of compression, e.g. 10
//
// Improvement of tq.q available at https://github.com/KxSystems/kdb-taq
// Improvements include:
//    * k code is rewritten to q
//    * destination directory is not hardcoded
//    * new parameter to filter on the first letter of the Symbol
//    * improved error handling
//    * code quality improvements
//    * option to drop test Symbols
//    * columns are written in parallel
//    * support of batch processing for smaller memory usage



if[(5.0>.z.K); -2 "kdb+ 5 is required";exit 1];

USAGE: "usage: q ", string[.z.f], " [-help] -src SRC -date DATE -dst DST [-batchsize N] [-letters START-END] [-includetestsymbols] [-debug]\n\n",
  "Parses NYSE TAQ PSV files and persists the content into a partitioned kdb+ database."
ko: key o: first each .Q.opt .z.x
if[`help in ko; -1 USAGE; exit 0]

([parseToDisk]): use `kx.taq.taq / TODO: change to kx.taq after packeage management is implemented

opt: ([])
if[`batchsize in ko; opt[`batchsize]: "J"$o `batchsize]
if[`letters in ko; opt[`letters]: o `letters]
if[`includetestsymbols in ko; opt[`includetestsymbols]: 1b]

parseToDisk[o `src; "D"$o `date; o `dst; opt]

if[not `debug in ko; exit 0]
