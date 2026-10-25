import { describe, expect, it } from 'vitest';
import { formatRanges, parseRanges, parseView, serializeView } from './url';
import { defaultView, type View } from './view';

const roundTrip = (v: View) => parseView(serializeView(v));

describe('URL codec', () => {
	it('gives the default view an empty URL', () => {
		expect(serializeView(defaultView())).toBe('');
		expect(parseView('')).toEqual(defaultView());
	});

	it('round-trips every field', () => {
		const v: View = {
			size: 'large',
			solution: 'KDB-X (Manual Opt)',
			machines: ['AMD_EPYC_9575F', 'INTEL_XEON_6738P'],
			pairs: ['1@0', '64@0', '128@all'],
			solutions: ['KDB-X', 'DuckDB (Sym, Time Sort)', 'chDB (Memory, Compressed)'],
			openSource: ['yes'],
			sortCols: ['sym-time'],
			machine: 'INTEL_XEON_6738P',
			date: '2026-04-01',
			numa: ['0', 'all'],
			threads: '16',
			timing: 'hot2',
			baseline: 'Polars (Lazy)',
			scale: 'log',
			tab: 'load',
			breakdownOpen: true,
			highlight: 'KDB-X (Manual Opt)',
			rows: { kind: 'fails', series: 'Pandas' },
			unticked: [1, 2, 3, 7, 9, 10],
			instruments: ['single', 'single:frequent', 'all'],
			complexity: ['simple'],
			includeTags: ['pivot'],
			excludeTags: []
		};
		expect(roundTrip(v)).toEqual(v);
	});

	it('keeps commas inside solution names', () => {
		const v = defaultView();
		v.solutions = ['DuckDB (Sym, Time Sort)', 'Pandas'];
		const s = serializeView(v);
		expect(s).toContain('DuckDB%20(Sym%2C%20Time%20Sort),Pandas');
		expect(parseView(s).solutions).toEqual(v.solutions);
	});

	it('distinguishes "default" from "none selected"', () => {
		expect(parseView('?solutions=').solutions).toEqual([]);
		expect(parseView('').solutions).toBeNull();
		expect(parseView('?notags=').excludeTags).toEqual([]);
	});

	it('reads the spec example', () => {
		const v = parseView('?size=full&solutions=KDB-X,Pandas&threads=4');
		expect(v.solutions).toEqual(['KDB-X', 'Pandas']);
		expect(v.threads).toBe('4');
	});

	it('ignores unknown and invalid values', () => {
		const v = parseView('?size=huge&timing=lukewarm&scale=sideways&tab=nope&bd=2&rows=bogus&rows2=x&skip=a-b,5,9-3&foo=bar&open=maybe,yes');
		expect(v.size).toBe('full');
		expect(v.timing).toBe('cold');
		expect(v.scale).toBe('linear');
		expect(v.tab).toBe('queries');
		expect(v.breakdownOpen).toBe(false);
		expect(v.rows).toBeNull();
		expect(v.unticked).toEqual([5]);
		expect(v.openSource).toEqual(['yes']);
	});

	it('survives malformed escapes', () => {
		expect(() => parseView('?solutions=%E0%A4%A&machine=%')).not.toThrow();
	});

	it('omits parameters that equal the default', () => {
		const v = defaultView();
		v.timing = 'hot';
		expect(serializeView(v)).toBe('?timing=hot');
	});
});

describe('ranges', () => {
	it('compacts and expands', () => {
		expect(formatRanges([1, 2, 3, 5, 7, 8, 9, 10, 20])).toBe('1-3,5,7-10,20');
		expect(formatRanges([4, 5])).toBe('4,5');
		expect(parseRanges('1-3,5,7-10,20')).toEqual([1, 2, 3, 5, 7, 8, 9, 10, 20]);
		expect(parseRanges('')).toEqual([]);
	});
});
