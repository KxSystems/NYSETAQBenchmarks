import { describe, expect, it } from 'vitest';
import { defaultView } from '../state/view';
import { allInstrumentTokens, filterQueries, instrumentOptions } from './queries';
import { mkDataset } from './fixtures';

const ds = mkDataset(); // q1 single:frequent, q2 multi:50 [pivot], q3 all, q4 single:infrequent complex
const idxs = (v = defaultView()) => filterQueries(ds, v).map((q) => q.idx);

describe('filterQueries', () => {
	it('passes everything by default', () => {
		expect(idxs()).toEqual([1, 2, 3, 4]);
	});
	it('builds the two-level instrument options', () => {
		expect(instrumentOptions(ds)).toEqual([
			{ scope: 'single', refinements: ['single:frequent', 'single:infrequent'] },
			{ scope: 'multi', refinements: ['multi:50'] },
			{ scope: 'all', refinements: [] }
		]);
	});
	it('requires the scope and the refinement', () => {
		const v = defaultView();
		v.instruments = allInstrumentTokens(ds).filter((t) => t !== 'single:frequent');
		expect(idxs(v)).toEqual([2, 3, 4]);
		v.instruments = ['single:frequent', 'single:infrequent']; // scope itself deselected
		expect(idxs(v)).toEqual([]);
		v.instruments = ['all'];
		expect(idxs(v)).toEqual([3]);
	});
	it('filters by complexity', () => {
		const v = defaultView();
		v.complexity = ['complex'];
		expect(idxs(v)).toEqual([4]);
	});
	it('include tags restrict to queries carrying at least one', () => {
		const v = defaultView();
		v.includeTags = ['pivot', 'sort'];
		expect(idxs(v)).toEqual([2]);
	});
	it('exclude tags remove queries carrying any; defaults exclude two tags', () => {
		const v = defaultView();
		v.excludeTags = ['pivot'];
		expect(idxs(v)).toEqual([1, 3, 4]);
		v.excludeTags = [];
		expect(idxs(v)).toEqual([1, 2, 3, 4]);
	});
	it('returns queries in idx order', () => {
		const shuffled = { ...ds, queries: [...ds.queries].reverse() };
		expect(filterQueries(shuffled, defaultView()).map((q) => q.idx)).toEqual([1, 2, 3, 4]);
	});
});
