import { describe, expect, it } from 'vitest';
import {
	failureCounts,
	failureReason,
	failedQueries,
	geoMeanScores,
	orderByScore,
	ratio,
	timeOf,
	winCounts,
	winnersOf
} from './calc';
import { mkQueries, mkSeries } from './fixtures';

const Q = mkQueries(3);

describe('timeOf', () => {
	it('picks the selected timing', () => {
		const s = mkSeries('S', { 1: [10, 20, 30] });
		expect(timeOf(s, 1, 'cold')).toBe(10);
		expect(timeOf(s, 1, 'hot')).toBe(20);
		expect(timeOf(s, 1, 'hot2')).toBe(30);
		expect(timeOf(s, 2, 'cold')).toBeNull();
	});
});

describe('ratio', () => {
	it('divides by the baseline time', () => {
		expect(ratio(30, 10)).toBe(3);
		expect(ratio(5, 10)).toBe(0.5);
	});
	it('is undefined when either time is missing or the baseline is 0', () => {
		expect(ratio(null, 10)).toBeNull();
		expect(ratio(10, null)).toBeNull();
		expect(ratio(10, 0)).toBeNull();
	});
});

describe('failureReason', () => {
	const s = mkSeries('S', {}, { 1: 'error', 2: 'emptyquery', 3: 'skip' });
	it('maps statuses', () => {
		expect(failureReason(s, 1)).toBe('error');
		expect(failureReason(s, 2)).toBe('notimpl');
		expect(failureReason(s, 3)).toBe('notrun');
		expect(failureReason(s, 99)).toBe('notrun');
	});
});

describe('geoMeanScores', () => {
	it('is the geometric mean of ratios', () => {
		const base = mkSeries('B', { 1: 10, 2: 10, 3: 10 });
		const s = mkSeries('S', { 1: 20, 2: 5, 3: 10 }); // ratios 2, .5, 1 → gm 1
		const t = mkSeries('T', { 1: 40, 2: 40, 3: 10 }); // 4,4,1 → 16^(1/3)
		const rows = geoMeanScores([base, s, t], base, Q, 'cold');
		expect(rows[0]!.score).toBeCloseTo(1);
		expect(rows[1]!.score).toBeCloseTo(1);
		expect(rows[2]!.score).toBeCloseTo(Math.cbrt(16));
		expect(rows[2]).toMatchObject({ used: 3, penalised: 0 });
	});

	it('counts a failed query with the penalty ratio 2 × worst / baseline', () => {
		const base = mkSeries('B', { 1: 10, 2: 10 });
		const slow = mkSeries('Slow', { 1: 50, 2: 10 }); // worst(1) = 50
		const failing = mkSeries('F', { 1: 20 }, { 2: 'error' }); // q2 failed: worst(2)=10 → 2*10/10 = 2
		const rows = geoMeanScores([base, slow, failing], base, mkQueries(2), 'cold');
		const f = rows.find((r) => r.id === 'F')!;
		expect(f.penalised).toBe(1);
		expect(f.used).toBe(2);
		expect(f.score).toBeCloseTo(Math.sqrt(2 * 2)); // ratios: 20/10 = 2, penalty = 2
	});

	it('takes the worst time over compared series and the baseline', () => {
		const base = mkSeries('B', { 1: 100 });
		const f = mkSeries('F', {}, { 1: 'error' });
		const slow = mkSeries('S', { 1: 300 });
		// the baseline is not itself in the compared list here
		const rows = geoMeanScores([f, slow], base, mkQueries(1), 'cold');
		expect(rows.find((r) => r.id === 'F')!.score).toBeCloseTo((2 * 300) / 100);
		const rows2 = geoMeanScores([f], base, mkQueries(1), 'cold');
		expect(rows2[0]!.score).toBeCloseTo((2 * 100) / 100); // worst is the baseline's own
	});

	it('leaves out queries the baseline fails, for everyone', () => {
		const base = mkSeries('B', { 1: 10 }, { 2: 'error' });
		const s = mkSeries('S', { 1: 20, 2: 1 });
		const [row] = geoMeanScores([s], base, mkQueries(2), 'cold');
		expect(row).toMatchObject({ used: 1, penalised: 0 });
		expect(row!.score).toBeCloseTo(2);
	});

	it('leaves out queries where the baseline time is 0', () => {
		const base = mkSeries('B', { 1: 0, 2: 10 });
		const s = mkSeries('S', { 1: 5, 2: 20 });
		const [row] = geoMeanScores([s], base, mkQueries(2), 'cold');
		expect(row!.used).toBe(1);
		expect(row!.score).toBeCloseTo(2);
	});

	it('has no score without a usable query or baseline', () => {
		const base = mkSeries('B', {}, { 1: 'error' });
		const s = mkSeries('S', { 1: 5 });
		expect(geoMeanScores([s], base, mkQueries(1), 'cold')[0]!.score).toBeNull();
		expect(geoMeanScores([s], null, mkQueries(1), 'cold')[0]!.score).toBeNull();
	});

	it('uses the selected timing', () => {
		const base = mkSeries('B', { 1: [10, 20, 40] });
		const s = mkSeries('S', { 1: [10, 10, 10] });
		expect(geoMeanScores([s], base, mkQueries(1), 'cold')[0]!.score).toBeCloseTo(1);
		expect(geoMeanScores([s], base, mkQueries(1), 'hot')[0]!.score).toBeCloseTo(0.5);
		expect(geoMeanScores([s], base, mkQueries(1), 'hot2')[0]!.score).toBeCloseTo(0.25);
	});

	it('gives the baseline a score of 1 when it is among the compared series', () => {
		const base = mkSeries('B', { 1: 7, 2: 9 }, { 3: 'error' });
		expect(geoMeanScores([base], base, Q, 'cold')[0]!.score).toBeCloseTo(1);
	});
});

describe('orderByScore', () => {
	it('sorts ascending with unscored series last', () => {
		const items = [{ id: 'c' }, { id: 'a' }, { id: 'b' }, { id: 'd' }];
		const ordered = orderByScore(items, [
			{ id: 'a', score: 3, used: 1, penalised: 0 },
			{ id: 'b', score: 1, used: 1, penalised: 0 },
			{ id: 'c', score: null, used: 0, penalised: 0 },
			{ id: 'd', score: 2, used: 1, penalised: 0 }
		]);
		expect(ordered.map((i) => i.id)).toEqual(['b', 'd', 'a', 'c']);
	});
});

describe('wins', () => {
	const a = mkSeries('A', { 1: 5, 2: 9, 3: 7 });
	const b = mkSeries('B', { 1: 6, 2: 3, 3: 7 });
	const c = mkSeries('C', { 1: 5 }, { 2: 'error' });

	it('gives the win to the fastest', () => {
		expect(winnersOf([a, b, c], 2, 'cold')).toEqual(['B']);
	});
	it('gives every tied series the win', () => {
		expect(winnersOf([a, b, c], 1, 'cold').sort()).toEqual(['A', 'C']);
		expect(winnersOf([a, b], 3, 'cold').sort()).toEqual(['A', 'B']);
	});
	it('counts wins over the compared queries and skips queries nobody ran', () => {
		const counts = winCounts([a, b, c], mkQueries(4), 'cold');
		expect(Object.fromEntries(counts)).toEqual({ A: 2, B: 2, C: 1 });
	});
	it('returns nothing when no series has a time', () => {
		expect(winnersOf([c], 2, 'cold')).toEqual([]);
	});
});

describe('failures', () => {
	const s = mkSeries('S', { 1: 1 }, { 2: 'error', 3: 'emptyquery', 4: 'skip' });
	const queries = mkQueries(5); // 5 is neither in query_ns nor query_status
	it('counts by reason', () => {
		expect(failureCounts([s], queries, 'cold')[0]).toEqual({
			id: 'S',
			error: 1,
			notimpl: 1,
			notrun: 2,
			total: 4
		});
	});
	it('only counts compared queries', () => {
		expect(failureCounts([s], [queries[1]!, queries[0]!], 'cold')[0]!.total).toBe(1);
	});
	it('lists the failed queries', () => {
		expect(failedQueries(s, queries, 'cold').map((q) => q.idx)).toEqual([2, 3, 4, 5]);
	});
});
