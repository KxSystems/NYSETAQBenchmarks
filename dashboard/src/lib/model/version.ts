import type { Dataset } from '../data/types';

/** `1.10` sorts after `1.9`. */
function compareVersions(a: string, b: string): number {
	const pa = a.split('.').map(Number);
	const pb = b.split('.').map(Number);
	for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
		const d = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (d !== 0 && !Number.isNaN(d)) return d;
	}
	return a.localeCompare(b);
}

/** Benchmark versions with runs in this file, oldest first. */
export function versionOptions(ds: Dataset): string[] {
	const versions = new Set<string>();
	for (const r of ds.runs) if (r.benchmark_version) versions.add(r.benchmark_version);
	return [...versions].sort(compareVersions);
}

/** The version to show: the chosen one if the file has it, otherwise the latest; null when no run is versioned. */
export function effectiveVersion(ds: Dataset, chosen: string | null): string | null {
	const options = versionOptions(ds);
	return chosen && options.includes(chosen) ? chosen : (options[options.length - 1] ?? null);
}

/**
 * The file as it looks for one benchmark version: only that version's runs. Results of
 * different versions are not comparable, so the pages never see more than one.
 */
export function forVersion(ds: Dataset, version: string | null): Dataset {
	if (version === null) return ds;
	return { ...ds, runs: ds.runs.filter((r) => r.benchmark_version === version) };
}
