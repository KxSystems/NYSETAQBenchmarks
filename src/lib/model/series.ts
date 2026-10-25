import type { Dataset, QueryMeta, Run, ThreadMeasurement } from '../data/types';
import { DEFAULT_BASELINE, DEFAULT_SOLUTIONS, type View } from '../state/view';
import { solutionOrder, styleFor, type SeriesStyle } from './colours';
import { compareNames, sortColumnsKey } from './format';
import { filterQueries } from './queries';
import { effectiveSetup, pickRun, type Setup } from './setup';

/**
 * One compared item with its measurements. The calculations, charts and tables only
 * know this shape, so the hardware and thread-scaling pages can supply machines or
 * thread counts instead of solutions.
 */
export interface Series {
	id: string;
	label: string;
	style: SeriesStyle;
	run: Run;
	m: ThreadMeasurement;
}

/** A selected solution whose run failed before running any query. */
export interface FailedSeries {
	id: string;
	label: string;
	style: SeriesStyle;
	exitCode: number;
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

function measurement(run: Run, setup: Setup): ThreadMeasurement | null {
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
			compared.push({ id: name, label: name, style: styleOf(name), run, m });
		}
	}
	if (multiRun > 0) {
		notices.push(
			`${multiRun} ${multiRun === 1 ? 'solution has' : 'solutions have'} runs on several NUMA nodes; using node "all" where present, otherwise the lowest node.`
		);
	}

	// Baseline: the visitor's choice if it has a usable run, else the first compared solution.
	const baselineChoice = view.baseline ?? DEFAULT_BASELINE;
	let baseline: Series | null = null;
	const chosen = ds.solutions[baselineChoice] ? pickRun(ds, baselineChoice, setup).run : null;
	const chosenM = chosen ? measurement(chosen, setup) : null;
	if (chosen && chosenM) {
		baseline =
			compared.find((s) => s.id === baselineChoice) ?? {
				id: baselineChoice,
				label: baselineChoice,
				style: styleOf(baselineChoice),
				run: chosen,
				m: chosenM
			};
	} else if (compared.length > 0) {
		baseline = compared[0]!;
		notices.push(
			`${baselineChoice} has no results for this setup; using ${baseline.label} as the baseline.`
		);
	}

	const queries = filterQueries(ds, view);
	const unticked = new Set(view.unticked);
	const comparedQueries = queries.filter((q) => !unticked.has(q.idx));

	return { setup, compared, failed, baseline, baselineChoice, queries, comparedQueries, notices, styles };
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
