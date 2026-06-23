getQueryParameters: {[paramdir]
    aFreqInstr:: first `$read0 .Q.dd[paramdir;`aFreqInstr.txt];
    mostFreqInstr:: first `$read0 .Q.dd[paramdir;`mostFreqInstr.txt];
    anInfreqInstr:: first `$read0 .Q.dd[paramdir;`anInfreqInstr.txt];
    twentyInstrs:: `$read0 .Q.dd[paramdir;`twentyInstrs.txt];
    hundredInstrs:: `$read0 .Q.dd[paramdir;`hundredInstrs.txt];
    fivehundredInfreqInstrs:: `$read0 .Q.dd[paramdir;`fivehundredInfreqInstrs.txt];

    timeBuckets:: asc(!/) (`$; "N"$) @' flip  "=" vs/: read0 .Q.dd[paramdir; `timeBuckets.txt];
    timeBucketsStep:: `s#value[timeBuckets]!key timeBuckets;
    }