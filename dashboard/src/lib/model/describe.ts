import type { Dataset, MachineMeta, QueryMeta } from '../data/types';
import type { SpecEntry, TipContent } from '../state/tooltip.svelte';
import { instrumentRefinementLabel, sortColumnsLabel } from './format';

const SECTION_ORDER = ['os', 'cpu', 'memory'];

function entries(obj: Record<string, unknown>): SpecEntry[] {
	return Object.entries(obj).map(([key, value]) =>
		value !== null && typeof value === 'object' && !Array.isArray(value)
			? { key, children: entries(value as Record<string, unknown>) }
			: { key, value: value === '' || value === null ? '—' : String(value) }
	);
}

/** Full machine specification: every key present, grouped by section, nested objects indented. */
export function machineTip(name: string, m: MachineMeta): TipContent {
	const env = m.environment ?? {};
	const sections = [
		...SECTION_ORDER.filter((s) => s in env),
		...Object.keys(env).filter((s) => !SECTION_ORDER.includes(s))
	];
	const groups = sections.map((heading) => {
		const v = env[heading];
		const list =
			v !== null && typeof v === 'object' && !Array.isArray(v)
				? entries(v as Record<string, unknown>)
				: [{ key: heading, value: String(v) }];
		return { heading, entries: list };
	});
	return {
		title: name,
		lines: [m.cpu_model, `Specification taken ${m.test_date}`],
		groups
	};
}

export function solutionTip(ds: Dataset, name: string): TipContent {
	const sol = ds.solutions[name];
	if (!sol) return { title: name };
	const versions = [
		...new Set(ds.runs.filter((r) => r.solution === name && r.engine_version).map((r) => r.engine_version!))
	];
	const lines = [
		`Engine: ${sol.engine ?? 'unknown'}`,
		`Version${versions.length === 1 ? '' : 's'}: ${versions.length ? versions.join(', ') : 'unknown'}`,
		`Language: ${sol.language ?? 'unknown'}`
	];
	if (sol.sort_columns) lines.push(`Sorted by: ${sortColumnsLabel(sol.sort_columns)}`);
	return { title: name, lines };
}

/** The base tooltip with the details of the series appended (machine specification, thread-count run). */
export function withSeriesTip(base: TipContent, extra: TipContent | undefined): TipContent {
	if (!extra) return base;
	return {
		...base,
		lines: [...(base.lines ?? []), ...(extra.lines ?? [])],
		groups: [...(base.groups ?? []), ...(extra.groups ?? [])]
	};
}

export function queryTip(q: QueryMeta): TipContent {
	const [scope, ref] = q.instrument.split(':');
	const lines = [
		q.description,
		`Tags: ${q.tags.length ? q.tags.join(', ') : 'none'}`,
		`Instrument: ${scope}${ref ? ` (${instrumentRefinementLabel(ref)})` : ''}`,
		`Complexity: ${q.complexity}`
	];
	if (q.comment) lines.push(`Comment: ${q.comment}`);
	return { title: `Q${q.idx}`, lines };
}
