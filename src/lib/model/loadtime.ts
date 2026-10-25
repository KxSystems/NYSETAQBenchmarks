import { kbToGB, mbToGB } from './format';
import type { Series } from './series';

export const PHASE_LABEL: Record<string, string> = {
	load: 'Load into memory',
	transform: 'Transform',
	sort: 'Sort',
	index: 'Index'
};

export function phaseLabel(key: string): string {
	return PHASE_LABEL[key] ?? key;
}

/** Phases present in any compared series, in pipeline order (unknown keys last). */
export function phasesPresent(loadPhases: string[], compared: Series[]): string[] {
	const present = new Set(compared.flatMap((s) => Object.keys(s.m.load_ns)));
	const known = loadPhases.filter((p) => present.has(p));
	const extra = [...present].filter((p) => !loadPhases.includes(p)).sort();
	return [...known, ...extra];
}

/** Sum of the phases the series has; a missing phase counts as 0. */
export function totalLoadNs(s: Series): number {
	return Object.values(s.m.load_ns).reduce((a, b) => a + b, 0);
}

export interface LoadRow {
	id: string;
	total: number;
	/** Phase key → ns; absent when the series does not have the phase. */
	phases: Record<string, number>;
	/** Total relative to the baseline's total; null when undefined. */
	ratio: number | null;
}

/** Load rows sorted by total ascending. */
export function loadRows(compared: Series[], baseline: Series | null): LoadRow[] {
	const baseTotal = baseline ? totalLoadNs(baseline) : null;
	return compared
		.map((s) => {
			const total = totalLoadNs(s);
			return {
				id: s.id,
				total,
				phases: { ...s.m.load_ns },
				ratio: baseTotal !== null && baseTotal > 0 ? total / baseTotal : null
			};
		})
		.sort((a, b) => a.total - b.total || a.id.localeCompare(b.id));
}

export interface MemoryBar {
	id: string;
	/** GB, or null when the run has no value ("n/a"). */
	gb: number | null;
}

function memoryBars(compared: Series[], value: (s: Series) => number | null): MemoryBar[] {
	return compared
		.map((s) => ({ id: s.id, gb: value(s) }))
		.sort((a, b) => {
			if (a.gb === null && b.gb === null) return a.id.localeCompare(b.id);
			if (a.gb === null) return 1;
			if (b.gb === null) return -1;
			return a.gb - b.gb || a.id.localeCompare(b.id);
		});
}

export function peakMemoryBars(compared: Series[]): MemoryBar[] {
	return memoryBars(compared, (s) => (s.run.peak_memory_kb === null ? null : kbToGB(s.run.peak_memory_kb)));
}

export function dataSizeBars(compared: Series[]): MemoryBar[] {
	return memoryBars(compared, (s) => (s.run.data_size_mb === null ? null : mbToGB(s.run.data_size_mb)));
}
