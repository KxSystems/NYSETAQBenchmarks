import type { Dataset, Run } from '../data/types';
import type { TipContent } from '../state/tooltip.svelte';
import type { View } from '../state/view';
import { seqStyle, type SeriesStyle } from './colours';
import { compareNames, formatGB, kbToGB, mbToGB, threadsLabel } from './format';
import {
	chooseBaseline,
	resolveQueries,
	type BaselineOption,
	type Resolved,
	type Series
} from './series';
import { effectiveSolution } from './singlesolution';
import type { Setup } from './setup';

const ok = (r: Run) => r.exit_code === 0;

/** Series id of a (thread count, NUMA node) pair, e.g. `64@0` or `128@all`. */
export function pairId(threads: number | string, node: string): string {
	return `${threads}@${node}`;
}

export function parsePairId(id: string): { threads: number; node: string } | null {
	const m = /^(\d+)@(.+)$/.exec(id);
	return m ? { threads: Number(m[1]), node: m[2]! } : null;
}

/** Distinct thread counts the solution measured on the machine, over all dates. */
function measuredThreadCount(ds: Dataset, solution: string | null, machine: string): number {
	const th = new Set<string>();
	for (const r of ds.runs) {
		if (r.solution === solution && r.machine === machine && ok(r)) for (const t of Object.keys(r.threads)) th.add(t);
	}
	return th.size;
}

/** Machines with a run of the solution, most measured thread counts first. */
export function threadsMachineOptions(ds: Dataset, solution: string | null): string[] {
	const has = new Set(ds.runs.filter((r) => r.solution === solution).map((r) => r.machine));
	const count = new Map([...has].map((m) => [m, measuredThreadCount(ds, solution, m)]));
	return Object.keys(ds.machines)
		.filter((m) => has.has(m))
		.sort((a, b) => count.get(b)! - count.get(a)! || compareNames(a, b));
}

export function threadsDateOptions(ds: Dataset, solution: string | null, machine: string | null): string[] {
	return [...new Set(ds.runs.filter((r) => r.solution === solution && r.machine === machine).map((r) => r.datadate))].sort();
}

/** NUMA nodes of the solution's runs on the machine and date: numbers first, then `all`. */
export function threadsNumaOptions(ds: Dataset, solution: string | null, machine: string | null, date: string | null): string[] {
	const nodes = new Set(
		ds.runs.filter((r) => r.solution === solution && r.machine === machine && r.datadate === date).map((r) => r.numa_node)
	);
	const num = [...nodes].filter((n) => n !== 'all' && !Number.isNaN(Number(n))).sort((a, b) => Number(a) - Number(b));
	const other = [...nodes].filter((n) => n !== 'all' && !num.includes(n)).sort();
	return [...num, ...other, ...(nodes.has('all') ? ['all'] : [])];
}

const nodeRank = (n: string) => (n === 'all' ? Infinity : Number.isNaN(Number(n)) ? Number.MAX_VALUE : Number(n));

export interface Pair {
	id: string;
	threads: number;
	node: string;
	run: Run;
	label: string;
	tip: TipContent;
	style: SeriesStyle;
}

export interface ThreadsSetup extends Setup {
	solution: string | null;
	/** Every available (thread count, node) pair, ascending, with labels, tooltips and colours. */
	available: Pair[];
	/** Failed runs of the solution on the machine and date whose node is selected. */
	failedRuns: Run[];
}

/** The node most pairs ran on; ties go to the lowest node. */
function majorityNode(pairs: { node: string }[]): string | null {
	const count = new Map<string, number>();
	for (const p of pairs) count.set(p.node, (count.get(p.node) ?? 0) + 1);
	return [...count.entries()].sort((a, b) => b[1] - a[1] || nodeRank(a[0]) - nodeRank(b[0]))[0]?.[0] ?? null;
}

/** Resolve the visitor's choices and build the available pairs. */
export function threadsSetup(ds: Dataset, view: View): ThreadsSetup {
	const solution = effectiveSolution(ds, view);
	const machines = threadsMachineOptions(ds, solution);
	const machine = view.machine && machines.includes(view.machine) ? view.machine : (machines[0] ?? null);
	const dates = threadsDateOptions(ds, solution, machine);
	const date = view.date && dates.includes(view.date) ? view.date : (dates[dates.length - 1] ?? null);
	const numa = view.numa ?? threadsNumaOptions(ds, solution, machine, date);

	const runs = ds.runs.filter(
		(r) => r.solution === solution && r.machine === machine && r.datadate === date && numa.includes(r.numa_node)
	);
	const raw = runs
		.filter(ok)
		.flatMap((run) => Object.keys(run.threads).map((t) => ({ threads: Number(t), node: run.numa_node, run })))
		.sort((a, b) => a.threads - b.threads || nodeRank(a.node) - nodeRank(b.node));

	const perCount = new Map<number, number>();
	for (const p of raw) perCount.set(p.threads, (perCount.get(p.threads) ?? 0) + 1);
	const majority = majorityNode(raw);
	const mixed = new Set(raw.map((p) => p.node)).size > 1;

	const available: Pair[] = raw.map((p, i) => {
		const dup = (perCount.get(p.threads) ?? 0) > 1;
		const nodeText = p.node === 'all' ? 'all nodes' : `node ${p.node}`;
		const label = dup ? `${threadsLabel(p.threads)} (${nodeText})` : threadsLabel(p.threads);
		const lines = [`${threadsLabel(p.threads)}, NUMA ${p.node === 'all' ? 'unpinned (all nodes)' : `node ${p.node}`}`];
		if (mixed && p.node !== majority) {
			lines.push(p.node === 'all' ? 'ran unpinned, on all NUMA nodes' : `ran pinned to NUMA node ${p.node}`);
		}
		return {
			id: pairId(p.threads, p.node),
			threads: p.threads,
			node: p.node,
			run: p.run,
			label,
			tip: { title: label, lines },
			style: seqStyle(i, raw.length)
		};
	});

	return {
		solution,
		machine,
		date,
		numa,
		threads: null,
		available,
		failedRuns: runs.filter((r) => !ok(r)),
		pairs: available.map((p) => ({ id: p.id, label: p.label }))
	};
}

/** Selected pairs: the visitor's choice among the available ones, all by default. */
export function selectedPairs(setup: ThreadsSetup, view: View): Pair[] {
	return view.pairs ? setup.available.filter((p) => view.pairs!.includes(p.id)) : setup.available;
}

function toSeries(p: Pair, solution: string): Series {
	return {
		id: p.id,
		label: p.label,
		style: p.style,
		solution,
		run: p.run,
		m: p.run.threads[String(p.threads)]!,
		tip: p.tip,
		sortKey: p.threads
	};
}

export function resolveThreads(ds: Dataset, view: View): Resolved {
	const setup = threadsSetup(ds, view);
	const solution = setup.solution ?? '';
	const compared = selectedPairs(setup, view).map((p) => toSeries(p, solution));
	const styles = new Map(setup.available.map((p) => [p.id, p.style]));
	const notices: string[] = [];

	// Default baseline: the smallest thread count among the compared series.
	const baselineChoice = view.baseline ?? compared[0]?.id ?? '';
	const chosen = setup.available.find((p) => p.id === baselineChoice);
	const candidate = chosen ? toSeries(chosen, solution) : null;
	const { baseline, notice } = chooseBaseline(baselineChoice, chosen?.label ?? baselineChoice, candidate, compared);
	if (notice) notices.push(notice);

	let emptyReason: string | null = null;
	if (setup.available.length === 0 && setup.failedRuns.length > 0) {
		emptyReason = `${solution} failed on this machine: exit ${setup.failedRuns[0]!.exit_code}`;
	}

	const baselineOptions: BaselineOption[] = setup.available.map((p) => ({ id: p.id, label: p.label, hasResults: true }));

	return {
		setup,
		compared,
		failed: [],
		baseline,
		baselineChoice,
		...resolveQueries(ds, view),
		notices,
		styles,
		ordering: 'natural',
		baselineOptions,
		emptyReason
	};
}

/**
 * Peak memory and data size are measured once per run, not per thread count. The note lists the
 * values per contributing run: "Peak memory x GB and data size y GB (node 0 run); x GB and y GB (unpinned run)".
 */
export function memoryNote(compared: Series[]): string | null {
	const runs = [...new Map(compared.map((s) => [s.run.numa_node, s.run])).values()].sort(
		(a, b) => nodeRank(a.numa_node) - nodeRank(b.numa_node)
	);
	if (runs.length === 0) return null;
	const gb = (v: number | null) => (v === null ? 'n/a' : formatGB(v));
	const parts = runs.map((r, i) => {
		const peak = gb(r.peak_memory_kb === null ? null : kbToGB(r.peak_memory_kb));
		const size = gb(r.data_size_mb === null ? null : mbToGB(r.data_size_mb));
		const which = r.numa_node === 'all' ? 'unpinned run' : `node ${r.numa_node} run`;
		return i === 0 ? `Peak memory ${peak} GB and data size ${size} GB (${which})` : `${peak} GB and ${size} GB (${which})`;
	});
	return parts.join('; ');
}

/** Ideal linear scaling relative to the baseline: score = baseline threads ÷ series threads. */
export function linearScalingScore(baselineThreads: number, threads: number): number {
	return baselineThreads / threads;
}
