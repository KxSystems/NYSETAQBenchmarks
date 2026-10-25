import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SIZES, validateDataset } from '../data/load';
import { defaultView } from '../state/view';
import { failureCounts, geoMeanScores, orderByScore, winCounts } from './calc';
import { hardwareLogic, threadsLogic } from './pages';
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

describe('shipped data and the second-release pages', () => {
	const large = load('large');

	it('large is the largest size with runs on more than one machine (the default size of both pages)', () => {
		const sizes = SIZES.map((s) => ({ s, machines: new Set(load(s).runs.map((r) => r.machine)).size }));
		expect(sizes.filter((x) => x.machines > 1).map((x) => x.s)).toEqual(['large']);
		expect(hardwareLogic.defaultSize).toBe('large');
		expect(threadsLogic.defaultSize).toBe('large');
	});

	it('hardware: KDB-X on both machines, baseline AMD_EPYC_9575F', () => {
		const r = hardwareLogic.resolve(large, hardwareLogic.defaultView());
		expect(r.compared.map((s) => s.id)).toEqual(['AMD_EPYC_9575F', 'INTEL_XEON_6738P']);
		expect(r.baseline?.id).toBe('AMD_EPYC_9575F');
		expect(r.setup).toMatchObject({ solution: 'KDB-X', threads: '4' });
		const scores = geoMeanScores(r.compared, r.baseline, r.comparedQueries, 'cold');
		expect(scores.find((s) => s.id === 'AMD_EPYC_9575F')!.score).toBeCloseTo(1);
	});

	it('hardware: a solution that failed on one machine lists it as failed', () => {
		const r = hardwareLogic.resolve(large, { ...hardwareLogic.defaultView(), solution: 'Pandas' });
		expect(r.compared.map((s) => s.id)).toEqual(['AMD_EPYC_9575F']);
		expect(r.failed.map((f) => [f.id, f.exitCode])).toEqual([['INTEL_XEON_6738P', 137]]);
	});

	it('threads: the machine with the most thread counts, ascending thread order, baseline 1 thread', () => {
		const r = threadsLogic.resolve(large, threadsLogic.defaultView());
		expect(r.setup.machine).toBe('INTEL_XEON_6738P');
		expect(r.compared.map((s) => s.id)).toEqual(['1@0', '4@0', '16@0', '32@0', '64@0', '128@all']);
		expect(r.baseline?.id).toBe('1@0');
		const amd = threadsLogic.resolve(large, { ...threadsLogic.defaultView(), machine: 'AMD_EPYC_9575F' });
		expect(amd.compared).toHaveLength(5);
	});

	it('threads: the same thread count under two nodes is labelled with the node', () => {
		const r = threadsLogic.resolve(large, { ...threadsLogic.defaultView(), solution: 'pykx', machine: 'AMD_EPYC_9575F' });
		const labels = r.compared.map((s) => s.label);
		expect(labels).toContain('128 threads (node 0)');
		expect(labels).toContain('128 threads (all nodes)');
	});

	it('canonical views of the default views are the default views', () => {
		for (const p of [hardwareLogic, threadsLogic]) {
			expect(p.canonical(large, p.defaultView())).toEqual(p.defaultView());
		}
	});
});
