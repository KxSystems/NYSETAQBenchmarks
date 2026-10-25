import { describe, expect, it } from 'vitest';
import { mkDataset } from '../model/fixtures';
import { canonicalView } from './canonical';
import { defaultView } from './view';

const ds = mkDataset();

describe('canonicalView', () => {
	it('leaves the default view untouched', () => {
		expect(canonicalView(ds, defaultView())).toEqual(defaultView());
	});
	it('stores choices equal to the defaults as null', () => {
		const v = { ...defaultView(), machine: 'A', date: '2026-04-01', threads: '4', numa: ['all', '0'], baseline: 'KDB-X' };
		const c = canonicalView(ds, v);
		expect(c).toMatchObject({ machine: null, date: null, threads: null, numa: null, baseline: null });
	});
	it('keeps valid non-default choices and drops invalid ones', () => {
		const v = {
			...defaultView(),
			machine: 'B',
			threads: '999',
			solutions: ['Pandas', 'Nope'],
			unticked: [2, 99],
			highlight: 'Nope',
			rows: { kind: 'fails' as const, series: 'Nope' }
		};
		const c = canonicalView(ds, v);
		expect(c.machine).toBe('B');
		expect(c.threads).toBeNull();
		expect(c.solutions).toEqual(['Pandas']);
		expect(c.unticked).toEqual([2]);
		expect(c.highlight).toBeNull();
		expect(c.rows).toBeNull();
	});
	it('keeps an explicit empty selection', () => {
		const c = canonicalView(ds, { ...defaultView(), solutions: [], excludeTags: [] });
		expect(c.solutions).toEqual([]);
		expect(c.excludeTags).toEqual([]);
	});
});
