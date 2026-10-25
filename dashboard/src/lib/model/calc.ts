import type { QueryMeta } from '../data/types';
import { TIMING_INDEX, type Timing } from '../data/types';
import type { Series } from './series';

/** Time of a series on a query for the selected timing, or null if it has none. */
export function timeOf(s: Series, idx: number, timing: Timing): number | null {
	const t = s.m.query_ns[String(idx)];
	if (!t) return null;
	return t[TIMING_INDEX[timing]] ?? null;
}

export type FailReason = 'error' | 'notrun' | 'notimpl';

/** Why a series has no time on a query: error, not run (skip or absent), not implemented. */
export function failureReason(s: Series, idx: number): FailReason {
	const status = s.m.query_status?.[String(idx)];
	if (status === 'error') return 'error';
	if (status === 'emptyquery') return 'notimpl';
	return 'notrun';
}

export const FAIL_LABEL: Record<FailReason, string> = {
	error: 'error',
	notrun: 'not run',
	notimpl: 'not implemented'
};

/** time / baseline; undefined (null) when either is missing or the baseline is 0. */
export function ratio(t: number | null, base: number | null): number | null {
	if (t === null || base === null || base <= 0) return null;
	return t / base;
}

export interface ScoreRow {
	id: string;
	/** Geometric mean of ratios, null when no query is usable. */
	score: number | null;
	/** Number of queries the score is based on. */
	used: number;
	/** Of those, queries counted with the penalty ratio. */
	penalised: number;
}

/**
 * Geometric mean of per-query ratios for each compared series, relative to the baseline.
 * A failed query counts as `2 × worst(q) / baseline(q)`, where worst(q) is the largest time
 * posted for q by any compared series or the baseline. Queries the baseline has no time
 * for are left out for everyone.
 */
export function geoMeanScores(
	compared: Series[],
	baseline: Series | null,
	queries: QueryMeta[],
	timing: Timing
): ScoreRow[] {
	if (!baseline) return compared.map((s) => ({ id: s.id, score: null, used: 0, penalised: 0 }));

	// Per usable query: baseline time and the penalty ratio base.
	const usable: { idx: number; base: number; worst: number }[] = [];
	for (const q of queries) {
		const base = timeOf(baseline, q.idx, timing);
		if (base === null || base <= 0) continue;
		let worst = base;
		for (const s of compared) {
			const t = timeOf(s, q.idx, timing);
			if (t !== null && t > worst) worst = t;
		}
		usable.push({ idx: q.idx, base, worst });
	}

	return compared.map((s) => {
		let sum = 0;
		let used = 0;
		let penalised = 0;
		for (const u of usable) {
			const t = timeOf(s, u.idx, timing);
			if (t !== null) {
				sum += Math.log(t / u.base);
			} else {
				sum += Math.log((2 * u.worst) / u.base);
				penalised++;
			}
			used++;
		}
		return { id: s.id, score: used > 0 ? Math.exp(sum / used) : null, used, penalised };
	});
}

/** Series ids ordered best (lowest score) first; series without a score last. */
export function orderByScore<T extends { id: string }>(items: T[], scores: ScoreRow[]): T[] {
	const score = new Map(scores.map((r) => [r.id, r.score]));
	return [...items].sort((a, b) => {
		const sa = score.get(a.id) ?? null;
		const sb = score.get(b.id) ?? null;
		if (sa === null && sb === null) return a.id.localeCompare(b.id);
		if (sa === null) return 1;
		if (sb === null) return -1;
		return sa - sb || a.id.localeCompare(b.id);
	});
}

/** Ids of the series that post the fastest time on a query (all of them on an exact tie). */
export function winnersOf(compared: Series[], idx: number, timing: Timing): string[] {
	let best = Infinity;
	let ids: string[] = [];
	for (const s of compared) {
		const t = timeOf(s, idx, timing);
		if (t === null) continue;
		if (t < best) {
			best = t;
			ids = [s.id];
		} else if (t === best) {
			ids.push(s.id);
		}
	}
	return ids;
}

/** Wins per series over the queries. Queries nobody has a time for are left out. */
export function winCounts(compared: Series[], queries: QueryMeta[], timing: Timing): Map<string, number> {
	const counts = new Map(compared.map((s) => [s.id, 0]));
	for (const q of queries) {
		for (const id of winnersOf(compared, q.idx, timing)) counts.set(id, (counts.get(id) ?? 0) + 1);
	}
	return counts;
}

export interface FailureCounts {
	id: string;
	error: number;
	notrun: number;
	notimpl: number;
	total: number;
}

/** Number of queries each series fails, by reason. */
export function failureCounts(compared: Series[], queries: QueryMeta[], timing: Timing): FailureCounts[] {
	return compared.map((s) => {
		const c: FailureCounts = { id: s.id, error: 0, notrun: 0, notimpl: 0, total: 0 };
		for (const q of queries) {
			if (timeOf(s, q.idx, timing) !== null) continue;
			c[failureReason(s, q.idx)]++;
			c.total++;
		}
		return c;
	});
}

/** Queries a series fails. */
export function failedQueries(s: Series, queries: QueryMeta[], timing: Timing): QueryMeta[] {
	return queries.filter((q) => timeOf(s, q.idx, timing) === null);
}
