import type { Dataset } from '../data/types';
import type { View } from '../state/view';
import { resolve } from './series';

/**
 * Would this change of setup leave any solution with results? Used to dim filter values
 * that would give an empty view. The Solutions filters are ignored on purpose, so the
 * answer does not depend on what is currently ticked.
 */
export function hasResultsWith(ds: Dataset, view: View, patch: Partial<View>): boolean {
	const probe: View = {
		...view,
		...patch,
		solutions: Object.keys(ds.solutions),
		openSource: null,
		sortCols: null
	};
	return resolve(ds, probe).compared.length > 0;
}
