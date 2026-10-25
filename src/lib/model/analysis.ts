import type { Timing } from '../data/types';
import {
	failureCounts,
	geoMeanScores,
	orderByScore,
	winCounts,
	type FailureCounts,
	type ScoreRow
} from './calc';
import type { Resolved, Series } from './series';

/** Everything the query-statistics charts and the breakdown need, derived from a Resolved. */
export interface Analysis {
	/** Compared series in chart order: best score first, unscored last. */
	ordered: Series[];
	scores: Map<string, ScoreRow>;
	failures: Map<string, FailureCounts>;
	wins: Map<string, number>;
}

export function analyse(r: Resolved, timing: Timing): Analysis {
	const rows = geoMeanScores(r.compared, r.baseline, r.comparedQueries, timing);
	const ordered = orderByScore(r.compared, rows);
	const wins = winCounts(r.compared, r.comparedQueries, timing);
	return {
		ordered,
		scores: new Map(rows.map((s) => [s.id, s])),
		failures: new Map(failureCounts(r.compared, r.comparedQueries, timing).map((f) => [f.id, f])),
		wins
	};
}
