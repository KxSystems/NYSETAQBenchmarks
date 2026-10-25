import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIZES, validateDataset } from '../data/load';
import { defaultView } from '../state/view';
import { failureCounts, geoMeanScores, orderByScore, winCounts } from './calc';
import { resolve } from './series';

const load = (size: string) =>
	validateDataset(JSON.parse(readFileSync(`static/data/${size}.json`, 'utf8')), size);

describe.each(SIZES)('shipped data file: %s', (size) => {
	const ds = load(size);
	const r = resolve(ds, defaultView());

	it('resolves a default view with a baseline', () => {
		expect(r.setup.machine).toBe('AMD_EPYC_9575F');
		expect(r.setup.threads).toBe('4');
		expect(r.compared.length).toBeGreaterThan(0);
		expect(r.baseline?.id).toBe('KDB-X');
		expect(r.comparedQueries.length).toBeLessThan(84); // default excluded tags apply
	});

	it('scores the baseline at 1 and orders solutions by score', () => {
		const scores = geoMeanScores(r.compared, r.baseline, r.comparedQueries, 'cold');
		expect(scores.find((s) => s.id === 'KDB-X')!.score).toBeCloseTo(1);
		const ordered = orderByScore(r.compared, scores).map((s) => scores.find((x) => x.id === s.id)!.score!);
		expect(ordered).toEqual([...ordered].sort((a, b) => a - b));
	});

	it('wins never exceed the compared queries per solution and failures add up', () => {
		const wins = winCounts(r.compared, r.comparedQueries, 'cold');
		for (const n of wins.values()) expect(n).toBeLessThanOrEqual(r.comparedQueries.length);
		for (const f of failureCounts(r.compared, r.comparedQueries, 'cold')) {
			expect(f.error + f.notrun + f.notimpl).toBe(f.total);
		}
	});
});

describe('full data file', () => {
	it('lists the DuckDB solutions whose run failed with exit 137', () => {
		const r = resolve(load('full'), defaultView());
		expect(r.failed.map((f) => [f.id, f.exitCode])).toEqual([['DuckDB (Index)', 137]]);
	});
});
