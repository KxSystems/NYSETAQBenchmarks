import type { Dataset } from '../data/types';
import { sortColumnsKey } from '../model/format';
import { allInstrumentTokens, complexityOptions, tagOptions } from '../model/queries';
import {
	hardwareDateOptions,
	hardwareMachineOptions,
	hardwareNumaOptions,
	hardwareThreadOptions,
	HARDWARE_DEFAULT_BASELINE,
	selectedMachines
} from '../model/hardware';
import { selectedSolutions } from '../model/series';
import { defaultSolution, effectiveSolution } from '../model/singlesolution';
import {
	threadsDateOptions,
	threadsMachineOptions,
	threadsNumaOptions,
	threadsSetup
} from '../model/threads';
import {
	dateOptions,
	defaultThreads,
	effectiveSetup,
	machineOptions,
	numaOptions,
	threadOptions
} from '../model/setup';
import { DEFAULT_EXCLUDE_TAGS, DEFAULT_THREADS, sameSet, type View } from './view';

/** Replace invalid choices with defaults for this data file and null out choices equal to defaults. */
export function canonicalView(ds: Dataset, input: View): View {
	const v: View = { ...input };
	const solutionNames = Object.keys(ds.solutions);
	const keepKnown = (xs: string[] | null, valid: string[]) =>
		xs === null ? null : xs.filter((x) => valid.includes(x));
	const nullIfSame = (xs: string[] | null, all: string[]) =>
		xs !== null && sameSet(xs, all) ? null : xs;

	v.solutions = nullIfSame(keepKnown(v.solutions, solutionNames), selectedSolutions(ds, { ...v, solutions: null }));

	v.openSource = nullIfSame(v.openSource, ['yes', 'no']) as View['openSource'];
	const sortKeys = [...new Set(Object.values(ds.solutions).map((s) => sortColumnsKey(s.sort_columns)))];
	v.sortCols = nullIfSame(keepKnown(v.sortCols, sortKeys), sortKeys);

	const machines = machineOptions(ds);
	if (v.machine && !machines.includes(v.machine)) v.machine = null;
	if (v.machine === machines[0]) v.machine = null;
	const setup = effectiveSetup(ds, { ...v, date: null, threads: null, numa: null });
	const dates = dateOptions(ds, setup.machine);
	if (v.date && (!dates.includes(v.date) || v.date === dates[dates.length - 1])) v.date = null;
	const eff = effectiveSetup(ds, { ...v, threads: null, numa: null });
	const threads = threadOptions(ds, eff.machine, eff.date);
	if (v.threads && (!threads.includes(v.threads) || v.threads === defaultThreads(threads))) v.threads = null;
	const nodes = numaOptions(ds, eff.machine, eff.date);
	if (v.numa) {
		const valid = v.numa.filter((n) => nodes.includes(n));
		v.numa = valid.length === 0 || sameSet(valid, nodes) ? null : valid;
	}

	const tokens = allInstrumentTokens(ds);
	v.instruments = nullIfSame(keepKnown(v.instruments, tokens), tokens);
	const cx = complexityOptions(ds);
	v.complexity = nullIfSame(keepKnown(v.complexity, cx), cx);
	const tags = tagOptions(ds);
	v.includeTags = v.includeTags.filter((t) => tags.includes(t));
	v.excludeTags = nullIfSame(keepKnown(v.excludeTags, tags), DEFAULT_EXCLUDE_TAGS);

	const idxs = new Set(ds.queries.map((q) => q.idx));
	v.unticked = v.unticked.filter((i) => idxs.has(i));
	if (v.highlight && !solutionNames.includes(v.highlight)) v.highlight = null;
	if (v.rows && !solutionNames.includes(v.rows.series)) v.rows = null;
	if (v.baseline === 'KDB-X') v.baseline = null;
	return v;
}

const keepKnown = (xs: string[] | null, valid: string[]) => (xs === null ? null : xs.filter((x) => valid.includes(x)));
const nullIfSame = (xs: string[] | null, all: string[]) => (xs !== null && sameSet(xs, all) ? null : xs);
/** A choice that no longer exists (the old list was non-empty, nothing survives) falls back to the default. */
const keepOrDefault = (orig: string[] | null, valid: string[]) => {
	const kept = keepKnown(orig, valid);
	return orig !== null && orig.length > 0 && kept!.length === 0 ? null : nullIfSame(kept, valid);
};

/** The query-filter and breakdown parts shared by every page. */
function canonicalQueries(ds: Dataset, v: View, validSeries: (id: string) => boolean) {
	const tokens = allInstrumentTokens(ds);
	v.instruments = nullIfSame(keepKnown(v.instruments, tokens), tokens);
	const cx = complexityOptions(ds);
	v.complexity = nullIfSame(keepKnown(v.complexity, cx), cx);
	const tags = tagOptions(ds);
	v.includeTags = v.includeTags.filter((t) => tags.includes(t));
	v.excludeTags = nullIfSame(keepKnown(v.excludeTags, tags), DEFAULT_EXCLUDE_TAGS);
	const idxs = new Set(ds.queries.map((q) => q.idx));
	v.unticked = v.unticked.filter((i) => idxs.has(i));
	if (v.highlight && !validSeries(v.highlight)) v.highlight = null;
	if (v.rows && !validSeries(v.rows.series)) v.rows = null;
}

/** Canonical view of the hardware page. */
export function canonicalHardware(ds: Dataset, input: View): View {
	const v: View = { ...input };
	const solution = effectiveSolution(ds, v);
	v.solution = v.solution && v.solution === solution && solution !== defaultSolution(ds) ? v.solution : null;

	const machineOpts = hardwareMachineOptions(ds, solution);
	v.machines = keepOrDefault(v.machines, machineOpts);
	const machines = selectedMachines(ds, v, solution);
	const dates = hardwareDateOptions(ds, solution, machines);
	if (v.date && (!dates.includes(v.date) || v.date === dates[dates.length - 1])) v.date = null;
	const date = v.date ?? dates[dates.length - 1] ?? null;
	const threads = hardwareThreadOptions(ds, solution, machines, date);
	const defaultT = threads.includes(DEFAULT_THREADS) ? DEFAULT_THREADS : threads[0];
	if (v.threads && (!threads.includes(v.threads) || v.threads === defaultT)) v.threads = null;
	v.numa = keepOrDefault(v.numa, hardwareNumaOptions(ds, solution, machines, date));

	if (v.baseline && (!ds.machines[v.baseline] || v.baseline === HARDWARE_DEFAULT_BASELINE)) v.baseline = null;
	canonicalQueries(ds, v, (id) => id in ds.machines);
	return v;
}

/** Canonical view of the thread-scaling page. */
export function canonicalThreads(ds: Dataset, input: View): View {
	const v: View = { ...input };
	const solution = effectiveSolution(ds, v);
	v.solution = v.solution && v.solution === solution && solution !== defaultSolution(ds) ? v.solution : null;

	const machines = threadsMachineOptions(ds, solution);
	if (v.machine && (!machines.includes(v.machine) || v.machine === machines[0])) v.machine = null;
	const machine = v.machine ?? machines[0] ?? null;
	const dates = threadsDateOptions(ds, solution, machine);
	if (v.date && (!dates.includes(v.date) || v.date === dates[dates.length - 1])) v.date = null;
	const date = v.date ?? dates[dates.length - 1] ?? null;
	v.numa = keepOrDefault(v.numa, threadsNumaOptions(ds, solution, machine, date));

	const ids = threadsSetup(ds, { ...v, pairs: null }).available.map((p) => p.id);
	v.pairs = keepOrDefault(v.pairs, ids);
	if (v.baseline && !/^\d+@.+$/.test(v.baseline)) v.baseline = null;
	canonicalQueries(ds, v, (id) => ids.includes(id));
	return v;
}
