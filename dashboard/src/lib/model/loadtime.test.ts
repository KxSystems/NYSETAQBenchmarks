import { describe, expect, it } from 'vitest';
import { mkSeries } from './fixtures';
import { dataSizeBars, loadRows, peakMemoryBars, phasesPresent, totalLoadNs } from './loadtime';

const a = mkSeries('A', {}, {}, { load: 4e9, sort: 6e9, index: 1e9 });
const b = mkSeries('B', {}, {}, { load: 20e9 });
const phases = ['load', 'transform', 'sort', 'index'];

describe('load time', () => {
	it('totals the phases a series has', () => {
		expect(totalLoadNs(a)).toBe(11e9);
	});
	it('lists phases present in any series, in pipeline order', () => {
		expect(phasesPresent(phases, [a, b])).toEqual(['load', 'sort', 'index']);
	});
	it('sorts by total and ratios against the baseline total', () => {
		const rows = loadRows([b, a], a);
		expect(rows.map((r) => r.id)).toEqual(['A', 'B']);
		expect(rows[0]!.ratio).toBe(1);
		expect(rows[1]!.ratio).toBeCloseTo(20 / 11);
		expect(rows[1]!.phases.sort).toBeUndefined();
	});
	it('has no ratio without a baseline', () => {
		expect(loadRows([a], null)[0]!.ratio).toBeNull();
	});
});

describe('memory bars', () => {
	it('sorts ascending with n/a last', () => {
		const x = mkSeries('X', {});
		x.run.peak_memory_kb = 2 * 1024 * 1024;
		x.run.data_size_mb = 3 * 1024;
		const y = mkSeries('Y', {});
		y.run.peak_memory_kb = 1024 * 1024;
		const z = mkSeries('Z', {});
		expect(peakMemoryBars([z, x, y])).toEqual([
			{ id: 'Y', gb: 1 },
			{ id: 'X', gb: 2 },
			{ id: 'Z', gb: null }
		]);
		expect(dataSizeBars([x, y])).toEqual([
			{ id: 'X', gb: 3 },
			{ id: 'Y', gb: null }
		]);
	});
});
