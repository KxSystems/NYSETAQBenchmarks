import { DEFAULT_SIZE } from '../data/load';
import type { Timing } from '../data/types';

/**
 * The visitor's choices. Everything here is serialised into the URL.
 * `null` on a field means "follow the default rule", so a choice that equals the
 * default is never stored and the default view has a clean URL.
 */
export interface RowFilter {
	kind: 'fails' | 'wins';
	series: string;
}

export interface View {
	size: string;
	/** Benchmark version; null follows the latest. */
	version: string | null;
	/** Single-choice solution (hardware and thread-scaling pages). */
	solution: string | null;
	/** Selected machines (hardware page). */
	machines: string[] | null;
	/** Selected `threads@node` pairs (thread-scaling page). */
	pairs: string[] | null;
	solutions: string[] | null;
	openSource: ('yes' | 'no')[] | null;
	sortCols: string[] | null;
	machine: string | null;
	date: string | null;
	numa: string[] | null;
	threads: string | null;
	timing: Timing;
	baseline: string | null;
	scale: 'linear' | 'log';
	tab: 'queries' | 'load';
	breakdownOpen: boolean;
	highlight: string | null;
	rows: RowFilter | null;
	unticked: number[];
	instruments: string[] | null;
	complexity: string[] | null;
	includeTags: string[];
	excludeTags: string[] | null;
}

export type PanelId = 'solutions' | 'setup' | 'queries';

export const DEFAULT_SOLUTIONS = [
	'DuckDB (Index)',
	'KDB-X',
	'KDB-X (Manual Opt)',
	'Pandas',
	'Polars (Lazy)',
	'chDB (Memory)'
];
export const DEFAULT_BASELINE = 'KDB-X';
export const DEFAULT_EXCLUDE_TAGS = ['manydummyfilters', 'unnecessarycolumnfetch'];
export const DEFAULT_THREADS = '4';

export function defaultView(size: string = DEFAULT_SIZE): View {
	return {
		size,
		version: null,
		solution: null,
		machines: null,
		pairs: null,
		solutions: null,
		openSource: null,
		sortCols: null,
		machine: null,
		date: null,
		numa: null,
		threads: null,
		timing: 'cold',
		baseline: null,
		scale: 'linear',
		tab: 'queries',
		breakdownOpen: false,
		highlight: null,
		rows: null,
		unticked: [],
		instruments: null,
		complexity: null,
		includeTags: [],
		excludeTags: null
	};
}

/** Same set of strings, ignoring order and duplicates. */
export function sameSet(a: readonly string[], b: readonly string[]): boolean {
	const sa = new Set(a);
	const sb = new Set(b);
	return sa.size === sb.size && [...sa].every((x) => sb.has(x));
}
