import { availableSize } from '../data/load';
import { TIMING_LABEL } from '../data/types';
import type { Dataset } from '../data/types';
import { canonicalHardware, canonicalThreads, canonicalView } from '../state/canonical';
import { defaultView, type PanelId, type View } from '../state/view';
import { threadsLabel } from './format';
import { resolveHardware, selectedMachines } from './hardware';
import { hasResultsWith as solutionsHasResultsWith } from './options';
import { resolve, selectedSolutions, type Resolved } from './series';
import { effectiveSolution } from './singlesolution';
import { resolveThreads, selectedPairs, threadsSetup } from './threads';

export type PageId = 'solutions' | 'hardware' | 'threads';

export interface Chip {
	group: PanelId;
	text: string;
	dim?: boolean;
}

/**
 * Everything that differs between the three pages and is not a component: what the series are,
 * their defaults, status text and filter-bar chips. The calculations, charts and tables only see
 * the `Resolved` this produces.
 */
export interface PageLogic {
	id: PageId;
	/** Singular and plural name of what is compared, for titles and labels. */
	seriesNoun: [string, string];
	defaultSize: string;
	/** Memory charts (8.1, 8.2) per series, or a note per run. */
	memory: 'charts' | 'note';
	defaultView(): View;
	canonical(ds: Dataset, view: View): View;
	resolve(ds: Dataset, view: View): Resolved;
	/** Would this change still leave something to compare? (dims filter values) */
	hasResultsWith(ds: Dataset, view: View, patch: Partial<View>): boolean;
	/** The view change that removes one series from the comparison, or null. */
	removeSeries(ds: Dataset, view: View, id: string): Partial<View> | null;
	statusText(ds: Dataset, view: View, r: Resolved): string;
	chips(ds: Dataset, view: View, r: Resolved): Chip[];
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function queryCount(ds: Dataset, r: Resolved) {
	return `${r.comparedQueries.length} of ${ds.queries.length} queries`;
}

function queryChip(ds: Dataset, view: View, r: Resolved): Chip {
	const load = view.tab === 'load';
	return {
		group: 'queries',
		text: load ? 'queries n/a on this tab' : `${r.comparedQueries.length}/${ds.queries.length} queries`,
		dim: load
	};
}

function timingChip(view: View): Chip {
	return view.tab === 'load'
		? { group: 'setup', text: 'n/a on this tab', dim: true }
		: { group: 'setup', text: TIMING_LABEL[view.timing] };
}

export const solutionsLogic: PageLogic = {
	id: 'solutions',
	seriesNoun: ['solution', 'solutions'],
	defaultSize: availableSize('full'),
	memory: 'charts',
	defaultView: () => defaultView(),
	canonical: canonicalView,
	resolve,
	hasResultsWith: solutionsHasResultsWith,
	removeSeries: (ds, view, id) => ({ solutions: selectedSolutions(ds, view).filter((s) => s !== id) }),
	statusText(ds, view, r) {
		const load = view.tab === 'load';
		const n = r.compared.length;
		return [
			`Comparing ${plural(n, 'solution', 'solutions')}${r.failed.length ? ` (+${r.failed.length} failed)` : ''}${load ? '' : ` on ${queryCount(ds, r)}`}`,
			r.setup.machine ?? 'no machine',
			view.size,
			r.setup.date ?? 'no date',
			threadsLabel(r.setup.threads),
			load ? 'load times' : TIMING_LABEL[view.timing].toLowerCase(),
			r.baseline ? `baseline ${r.baseline.label}` : 'no baseline'
		].join(' · ');
	},
	chips: (ds, view, r) => [
		{ group: 'solutions', text: `${r.compared.length + r.failed.length} solutions` },
		{ group: 'setup', text: view.size },
		{ group: 'setup', text: r.setup.machine ?? 'no machine' },
		{ group: 'setup', text: threadsLabel(r.setup.threads) },
		timingChip(view),
		queryChip(ds, view, r)
	]
};

export const hardwareLogic: PageLogic = {
	id: 'hardware',
	seriesNoun: ['machine', 'machines'],
	defaultSize: availableSize('large'),
	memory: 'charts',
	defaultView: () => defaultView('large'),
	canonical: canonicalHardware,
	resolve: resolveHardware,
	hasResultsWith: (ds, view, patch) => resolveHardware(ds, { ...view, ...patch }).compared.length > 0,
	removeSeries(ds, view, id) {
		return { machines: selectedMachines(ds, view, effectiveSolution(ds, view)).filter((m) => m !== id) };
	},
	statusText(ds, view, r) {
		const load = view.tab === 'load';
		const n = r.compared.length;
		const solution = r.setup.solution ?? 'no solution';
		return [
			`Comparing ${solution} on ${plural(n, 'machine', 'machines')}${r.failed.length ? ` (+${r.failed.length} failed)` : ''}${load ? '' : ` on ${queryCount(ds, r)}`}`,
			view.size,
			r.setup.date ?? 'no date',
			threadsLabel(r.setup.threads),
			load ? 'load times' : TIMING_LABEL[view.timing].toLowerCase(),
			r.baseline ? `baseline ${r.baseline.label}` : 'no baseline'
		].join(' · ');
	},
	chips: (ds, view, r) => [
		{ group: 'solutions', text: r.setup.solution ?? 'no solution' },
		{ group: 'setup', text: plural(r.compared.length + r.failed.length, 'machine', 'machines') },
		{ group: 'setup', text: view.size },
		{ group: 'setup', text: threadsLabel(r.setup.threads) },
		timingChip(view),
		queryChip(ds, view, r)
	]
};

export const threadsLogic: PageLogic = {
	id: 'threads',
	seriesNoun: ['thread count', 'thread counts'],
	defaultSize: availableSize('large'),
	memory: 'note',
	defaultView: () => defaultView('large'),
	canonical: canonicalThreads,
	resolve: resolveThreads,
	hasResultsWith: (ds, view, patch) => resolveThreads(ds, { ...view, ...patch }).compared.length > 0,
	removeSeries(ds, view, id) {
		const setup = threadsSetup(ds, view);
		return { pairs: selectedPairs(setup, view).map((p) => p.id).filter((p) => p !== id) };
	},
	statusText(ds, view, r) {
		const load = view.tab === 'load';
		const solution = r.setup.solution ?? 'no solution';
		return [
			`${solution} on ${r.setup.machine ?? 'no machine'} at ${plural(r.compared.length, 'thread count', 'thread counts')}${load ? '' : ` on ${queryCount(ds, r)}`}`,
			view.size,
			r.setup.date ?? 'no date',
			load ? 'load times' : TIMING_LABEL[view.timing].toLowerCase(),
			r.baseline ? `baseline ${r.baseline.label}` : 'no baseline'
		].join(' · ');
	},
	chips: (ds, view, r) => [
		{ group: 'solutions', text: r.setup.solution ?? 'no solution' },
		{ group: 'setup', text: r.setup.machine ?? 'no machine' },
		{ group: 'setup', text: view.size },
		{ group: 'setup', text: plural(r.compared.length, 'thread count', 'thread counts') },
		timingChip(view),
		queryChip(ds, view, r)
	]
};

export const pageLogics: Record<PageId, PageLogic> = {
	solutions: solutionsLogic,
	hardware: hardwareLogic,
	threads: threadsLogic
};
