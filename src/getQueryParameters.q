getQueryParameters: {[paramdir]
    freqInstr:: first `$read0 .Q.dd[paramdir;`freqInstr.txt];
    infreqInstr:: first `$read0 .Q.dd[paramdir;`infreqInstr.txt];

    fiftyInstrs:: `$read0 .Q.dd[paramdir;`fiftyInstrs.txt];
    thousandInfreqInstrs:: `$read0 .Q.dd[paramdir;`thousandInfreqInstrs.txt];

    timeBuckets:: asc(!/) (`$; "N"$) @' flip  "=" vs/: read0 .Q.dd[paramdir; `timeBuckets.txt];
    timeBucketsStep:: `s#value[timeBuckets]!key timeBuckets;
    }