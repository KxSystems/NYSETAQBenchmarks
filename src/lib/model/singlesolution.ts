import type { Dataset } from '../data/types';
import type { View } from '../state/view';
import { DEFAULT_BASELINE } from '../state/view';
import { compareNames } from './format';

/** The default solution of the hardware and thread-scaling pages. */
export const DEFAULT_SOLUTION = DEFAULT_BASELINE;

/** Solutions with at least one run (successful or failed) in this data file, alphabetical. */
export function solutionsWithAnyRun(ds: Dataset): string[] {
	const names = new Set(ds.runs.map((r) => r.solution));
	return Object.keys(ds.solutions).filter((s) => names.has(s)).sort(compareNames);
}

export function defaultSolution(ds: Dataset): string | null {
	const options = solutionsWithAnyRun(ds);
	return options.includes(DEFAULT_SOLUTION) ? DEFAULT_SOLUTION : (options[0] ?? null);
}

/** The visitor's solution when valid, else the default (`KDB-X`, else the first alphabetically). */
export function effectiveSolution(ds: Dataset, view: Pick<View, 'solution'>): string | null {
	const options = solutionsWithAnyRun(ds);
	return view.solution && options.includes(view.solution) ? view.solution : defaultSolution(ds);
}
