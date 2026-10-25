import type { Dataset, QueryMeta, Run, ThreadMeasurement } from '../data/types';
import { DEFAULT_BASELINE, DEFAULT_SOLUTIONS, type View } from '../state/view';
import { solutionOrder, styleFor, type SeriesStyle } from './colours';
import { compareNames, sortColumnsKey } from './format';
import { filterQueries } from './queries';
import { effectiveSetup, pickRun, type Setup } from './setup';
import type { TipContent } from '../state/tooltip.svelte';

/**
 * One compared item with its measurements. The calculations, charts and tables only
 * know this shape, so the hardware and thread-scaling pages can supply machines or
 * thread counts instead of solutions.
 */
export interface Series {
	id: string;
	label: string;
	style: SeriesStyle;
	/** The solution whose query text and language apply to this series. */
	solution: string;
	run: Run;
	m: ThreadMeasurement;
	/** Hover details shown wherever the series is named (machine specification, thread-count run). */
	tip?: TipContent;
	/** Thread count, for series ordered by it. */
	sortKey?: number;
}

/** A selected solution whose run failed before running any query. */
export interface FailedSeries {
	id: string;
	label: string;
	style: SeriesStyle;
	exitCode: number;
	tip?: TipContent;
}

/** A series that can serve as the baseline, with whether it has results for the setup. */
export interface BaselineOption {
	id: string;
	label: string;
	hasResults: boolean;
}

export interface Resolved {
	setup: Setup;
	/** Compared series, alphabetical. Chart order is derived by sorting on scores. */
	compared: Series[];
	failed: FailedSeries[];
	baseline: Series | null;
	/** The visitor's baseline choice (may differ from `baseline`). */
	baselineChoice: string;
	/** Queries passing the query filters, in idx order. */
	queries: QueryMeta[];
	/** Of those, the ones ticked in the breakdown. */
	comparedQueries: QueryMeta[];
	notices: string[];
	styles: Map<string, SeriesStyle>;
	/** How charts and tables order the series: best score first, or as listed (thread counts). */
	ordering: 'score' | 'natural';
	baselineOptions: BaselineOption[];
	/** Why nothing can be compared, when the data says so (e.g. every run failed). */
	emptyReason: string | null;
}

/**
 * The baseline is the visitor's choice when it has a usable run; otherwise the first
 * compared series, with a notice. The choice itself is kept by the caller.
 */
export function chooseBaseline(
	choiceId: string,
	choiceLabel: string,
	candidate: Series | null,
	compared: Series[]
): { baseline: Series | null; notice: string | null } {
	if (candidate) {
		return { baseline: compared.find((s) => s.id === choiceId) ?? candidate, notice: null };
	}
	if (compared.length > 0) {
		const baseline = compared[0]!;
		return {
			baseline,
			notice: `${choiceLabel} has no results for this setup; using ${baseline.label} as the baseline.`
		};
	}
	return { baseline: null, notice: null };
}

/** Queries passing the query filters, and of those the ticked ones. */
export function resolveQueries(ds: Dataset, view: View): { queries: QueryMeta[]; comparedQueries: QueryMeta[] } {
	const queries = filterQueries(ds, view);
	const unticked = new Set(view.unticked);
	return { queries, comparedQueries: queries.filter((q) => !unticked.has(q.idx)) };
}

export function styleMap(ds: Dataset): Map<string, SeriesStyle> {
	return new Map(solutionOrder(Object.keys(ds.solutions)).map((n, i) => [n, styleFor(i)]));
}

export function selectedSolutions(ds: Dataset, view: View): string[] {
	if (view.solutions) return view.solutions.filter((s) => s in ds.solutions);
	return DEFAULT_SOLUTIONS.filter((s) => s in ds.solutions);
}

/** Does the solution pass the open-source and sort-column filters? */
export function passesSolutionFilters(ds: Dataset, name: string, view: View): boolean {
	const sol = ds.solutions[name];
	if (!sol) return false;
	if (view.openSource) {
		const key = sol.open_source === true ? 'yes' : sol.open_source === false ? 'no' : null;
		if (key === null ? view.openSource.length < 2 : !view.openSource.includes(key)) return false;
	}
	if (view.sortCols && !view.sortCols.includes(sortColumnsKey(sol.sort_columns))) return false;
	return true;
}

export function measurement(run: Run, setup: Setup): ThreadMeasurement | null {
	if (run.exit_code !== 0 || setup.threads === null) return null;
	return run.threads[setup.threads] ?? null;
}

export function resolve(ds: Dataset, view: View): Resolved {
	const setup = effectiveSetup(ds, view);
	const styles = styleMap(ds);
	const styleOf = (n: string) => styles.get(n) ?? styleFor(0);
	const notices: string[] = [];

	const compared: Series[] = [];
	const failed: FailedSeries[] = [];
	let multiRun = 0;
	const names = selectedSolutions(ds, view)
		.filter((n) => passesSolutionFilters(ds, n, view))
		.sort(compareNames);
	for (const name of names) {
		const { run, candidates } = pickRun(ds, name, setup);
		if (!run) continue;
		if (candidates > 1) multiRun++;
		const m = measurement(run, setup);
		if (run.exit_code !== 0) {
			failed.push({ id: name, label: name, style: styleOf(name), exitCode: run.exit_code });
		} else if (m) {
			compared.push({ id: name, label: name, style: styleOf(name), solution: name, run, m });
		}
	}
	if (multiRun > 0) {
		notices.push(
			`${multiRun} ${multiRun === 1 ? 'solution has' : 'solutions have'} runs on several NUMA nodes; using node "all" where present, otherwise the lowest node.`
		);
	}

	// Baseline: the visitor's choice if it has a usable run, else the first compared solution.
	const baselineChoice = view.baseline ?? DEFAULT_BASELINE;
	const chosen = ds.solutions[baselineChoice] ? pickRun(ds, baselineChoice, setup).run : null;
	const chosenM = chosen ? measurement(chosen, setup) : null;
	const candidate: Series | null =
		chosen && chosenM
			? {
					id: baselineChoice,
					label: baselineChoice,
					style: styleOf(baselineChoice),
					solution: baselineChoice,
					run: chosen,
					m: chosenM
				}
			: null;
	const { baseline, notice } = chooseBaseline(baselineChoice, baselineChoice, candidate, compared);
	if (notice) notices.push(notice);

	const { queries, comparedQueries } = resolveQueries(ds, view);
	const withResults = solutionsWithResults(ds, setup);
	const baselineOptions = solutionOrder(Object.keys(ds.solutions)).map((n) => ({
		id: n,
		label: n,
		hasResults: withResults.has(n)
	}));

	return {
		setup,
		compared,
		failed,
		baseline,
		baselineChoice,
		queries,
		comparedQueries,
		notices,
		styles,
		ordering: 'score',
		baselineOptions,
		emptyReason: null
	};
}

/** Solutions that have a usable (or failed) run for the setup, ignoring the solution filters. */
export function solutionsWithRuns(ds: Dataset, setup: Setup): Set<string> {
	const out = new Set<string>();
	for (const name of Object.keys(ds.solutions)) {
		if (pickRun(ds, name, setup).run) out.add(name);
	}
	return out;
}

/** Solutions with a successful run for the setup (valid baselines). */
export function solutionsWithResults(ds: Dataset, setup: Setup): Set<string> {
	const out = new Set<string>();
	for (const name of Object.keys(ds.solutions)) {
		const run = pickRun(ds, name, setup).run;
		if (run && measurement(run, setup)) out.add(name);
	}
	return out;
}
