import type { Dataset, Run } from '../data/types';
import { DEFAULT_THREADS, type View } from '../state/view';
import { compareNames } from './format';

/** The setup after fallbacks: every field is a concrete value (or null if nothing exists). */
export interface Setup {
	machine: string | null;
	date: string | null;
	numa: string[];
	threads: string | null;
}

const ok = (r: Run) => r.exit_code === 0;

/** Machines with runs in this file, most successful runs first. */
export function machineOptions(ds: Dataset): string[] {
	const count = new Map<string, number>();
	for (const name of Object.keys(ds.machines)) count.set(name, 0);
	for (const r of ds.runs) count.set(r.machine, (count.get(r.machine) ?? 0) + (ok(r) ? 1 : 0));
	return [...count.keys()]
		.filter((m) => ds.runs.some((r) => r.machine === m))
		.sort((a, b) => count.get(b)! - count.get(a)! || compareNames(a, b));
}

export function dateOptions(ds: Dataset, machine: string | null): string[] {
	const dates = new Set(ds.runs.filter((r) => r.machine === machine).map((r) => r.datadate));
	return [...dates].sort();
}

/** Numbers first (ascending), then `all`. */
export function numaOptions(ds: Dataset, machine: string | null, date: string | null): string[] {
	const nodes = new Set(
		ds.runs.filter((r) => r.machine === machine && r.datadate === date).map((r) => r.numa_node)
	);
	const num = [...nodes].filter((n) => n !== 'all' && !Number.isNaN(Number(n)));
	const other = [...nodes].filter((n) => !num.includes(n) && n !== 'all').sort();
	return [
		...num.sort((a, b) => Number(a) - Number(b)),
		...other,
		...(nodes.has('all') ? ['all'] : [])
	];
}

/** Thread counts measured for the machine and date, ascending. */
export function threadOptions(ds: Dataset, machine: string | null, date: string | null): string[] {
	const th = new Set<string>();
	for (const r of ds.runs) {
		if (r.machine === machine && r.datadate === date && ok(r)) {
			for (const t of Object.keys(r.threads)) th.add(t);
		}
	}
	return [...th].sort((a, b) => Number(a) - Number(b));
}

export function defaultThreads(options: string[]): string | null {
	return options.includes(DEFAULT_THREADS) ? DEFAULT_THREADS : (options[0] ?? null);
}

/** Resolve the visitor's choices against the data, falling back to defaults where invalid. */
export function effectiveSetup(ds: Dataset, view: View): Setup {
	const machines = machineOptions(ds);
	const machine = view.machine && machines.includes(view.machine) ? view.machine : (machines[0] ?? null);

	const dates = dateOptions(ds, machine);
	const date = view.date && dates.includes(view.date) ? view.date : (dates[dates.length - 1] ?? null);

	const threadOpts = threadOptions(ds, machine, date);
	const threads =
		view.threads && threadOpts.includes(view.threads) ? view.threads : defaultThreads(threadOpts);

	const numa = view.numa ?? numaOptions(ds, machine, date);
	return { machine, date, numa, threads };
}

/** Does this run match the setup? A failed run matches regardless of thread count. */
export function runMatches(r: Run, setup: Setup): boolean {
	if (r.machine !== setup.machine || r.datadate !== setup.date) return false;
	if (!setup.numa.includes(r.numa_node)) return false;
	return r.exit_code !== 0 || (setup.threads !== null && setup.threads in r.threads);
}

/**
 * The run of a solution to use: among the matching runs, node `all` if present,
 * otherwise the lowest node number.
 */
export function pickRun(ds: Dataset, solution: string, setup: Setup): { run: Run | null; candidates: number } {
	const cands = ds.runs.filter((r) => r.solution === solution && runMatches(r, setup));
	if (cands.length === 0) return { run: null, candidates: 0 };
	const all = cands.find((r) => r.numa_node === 'all');
	if (all) return { run: all, candidates: cands.length };
	const sorted = [...cands].sort((a, b) => {
		const na = Number(a.numa_node);
		const nb = Number(b.numa_node);
		return Number.isNaN(na) || Number.isNaN(nb) ? a.numa_node.localeCompare(b.numa_node) : na - nb;
	});
	return { run: sorted[0]!, candidates: cands.length };
}
