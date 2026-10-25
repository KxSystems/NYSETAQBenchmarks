import type { Dataset, QueryMeta } from '../data/types';
import { DEFAULT_EXCLUDE_TAGS, type View } from '../state/view';

export const COMPLEXITY_ORDER = ['simple', 'advanced', 'complex'];
const SCOPE_ORDER = ['single', 'multi', 'all'];

export function scopeOf(instrument: string): string {
	const i = instrument.indexOf(':');
	return i < 0 ? instrument : instrument.slice(0, i);
}

export interface InstrumentScope {
	scope: string;
	/** Full refinement tokens, e.g. `single:frequent`. */
	refinements: string[];
}

/** Two-level instrument options present in the data. */
export function instrumentOptions(ds: Dataset): InstrumentScope[] {
	const map = new Map<string, Set<string>>();
	for (const q of ds.queries) {
		const scope = scopeOf(q.instrument);
		if (!map.has(scope)) map.set(scope, new Set());
		if (q.instrument !== scope) map.get(scope)!.add(q.instrument);
	}
	const rank = (s: string) => {
		const i = SCOPE_ORDER.indexOf(s);
		return i < 0 ? SCOPE_ORDER.length : i;
	};
	return [...map.keys()]
		.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
		.map((scope) => ({ scope, refinements: [...map.get(scope)!].sort() }));
}

/** Every instrument token (scopes and refinements): the "all selected" default. */
export function allInstrumentTokens(ds: Dataset): string[] {
	return instrumentOptions(ds).flatMap((o) => [o.scope, ...o.refinements]);
}

export function complexityOptions(ds: Dataset): string[] {
	const present = new Set(ds.queries.map((q) => q.complexity));
	const known = COMPLEXITY_ORDER.filter((c) => present.has(c));
	const other = [...present].filter((c) => !COMPLEXITY_ORDER.includes(c)).sort();
	return [...known, ...other];
}

export function tagOptions(ds: Dataset): string[] {
	return Object.keys(ds.tags).sort();
}

export function effectiveExcludeTags(view: View): string[] {
	return view.excludeTags ?? DEFAULT_EXCLUDE_TAGS;
}

/**
 * Queries that pass the query filters, in idx order.
 * A query's instrument passes when its scope is selected and, if it has a
 * refinement, that refinement is selected.
 */
export function filterQueries(ds: Dataset, view: View): QueryMeta[] {
	const instruments = view.instruments ? new Set(view.instruments) : null;
	const complexity = view.complexity ? new Set(view.complexity) : null;
	const include = new Set(view.includeTags);
	const exclude = new Set(effectiveExcludeTags(view));
	return ds.queries
		.filter((q) => {
			if (instruments) {
				if (!instruments.has(scopeOf(q.instrument))) return false;
				if (q.instrument.includes(':') && !instruments.has(q.instrument)) return false;
			}
			if (complexity && !complexity.has(q.complexity)) return false;
			if (include.size && !q.tags.some((t) => include.has(t))) return false;
			if (q.tags.some((t) => exclude.has(t))) return false;
			return true;
		})
		.sort((a, b) => a.idx - b.idx);
}
