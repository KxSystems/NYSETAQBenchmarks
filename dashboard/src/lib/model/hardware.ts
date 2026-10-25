import type { Dataset, Run } from '../data/types';
import type { View } from '../state/view';
import { DEFAULT_THREADS } from '../state/view';
import { styleFor, type SeriesStyle } from './colours';
import { machineTip } from './describe';
import { compareNames } from './format';
import {
	chooseBaseline,
	measurement,
	resolveQueries,
	type BaselineOption,
	type FailedSeries,
	type Resolved,
	type Series
} from './series';
import { effectiveSolution } from './singlesolution';
import { pickRun, type Setup } from './setup';

/** Default baseline of the hardware page. */
export const HARDWARE_DEFAULT_BASELINE = 'AMD_EPYC_9575F';

const ok = (r: Run) => r.exit_code === 0;

/** Colours follow the alphabetical order of all machines in the file. */
export function machineStyleMap(ds: Dataset): Map<string, SeriesStyle> {
	return new Map(Object.keys(ds.machines).sort(compareNames).map((m, i) => [m, styleFor(i)]));
}

/** Machines with a run of the solution, alphabetical. */
export function hardwareMachineOptions(ds: Dataset, solution: string | null): string[] {
	const has = new Set(ds.runs.filter((r) => r.solution === solution).map((r) => r.machine));
	return Object.keys(ds.machines).filter((m) => has.has(m)).sort(compareNames);
}

/** Selected machines: the visitor's choice among the valid ones, all by default. */
export function selectedMachines(ds: Dataset, view: View, solution: string | null): string[] {
	const options = hardwareMachineOptions(ds, solution);
	return view.machines ? options.filter((m) => view.machines!.includes(m)) : options;
}

function runsOn(ds: Dataset, solution: string | null, machines: string[]): Run[] {
	return ds.runs.filter((r) => r.solution === solution && machines.includes(r.machine));
}

export function hardwareDateOptions(ds: Dataset, solution: string | null, machines: string[]): string[] {
	return [...new Set(runsOn(ds, solution, machines).map((r) => r.datadate))].sort();
}

export function hardwareNumaOptions(ds: Dataset, solution: string | null, machines: string[], date: string | null): string[] {
	const nodes = new Set(runsOn(ds, solution, machines).filter((r) => r.datadate === date).map((r) => r.numa_node));
	const num = [...nodes].filter((n) => n !== 'all' && !Number.isNaN(Number(n))).sort((a, b) => Number(a) - Number(b));
	const other = [...nodes].filter((n) => n !== 'all' && !num.includes(n)).sort();
	return [...num, ...other, ...(nodes.has('all') ? ['all'] : [])];
}

/** Thread counts the solution measured on the selected machines at the date. */
export function hardwareThreadOptions(ds: Dataset, solution: string | null, machines: string[], date: string | null): string[] {
	const th = new Set<string>();
	for (const r of runsOn(ds, solution, machines)) {
		if (r.datadate === date && ok(r)) for (const t of Object.keys(r.threads)) th.add(t);
	}
	return [...th].sort((a, b) => Number(a) - Number(b));
}

export interface HardwareSetup extends Setup {
	solution: string | null;
	machines: string[];
}

/** Resolve the visitor's choices, falling back to defaults where invalid. */
export function hardwareSetup(ds: Dataset, view: View): HardwareSetup {
	const solution = effectiveSolution(ds, view);
	const machines = selectedMachines(ds, view, solution);
	const dates = hardwareDateOptions(ds, solution, machines);
	const date = view.date && dates.includes(view.date) ? view.date : (dates[dates.length - 1] ?? null);
	const threadOpts = hardwareThreadOptions(ds, solution, machines, date);
	const threads =
		view.threads && threadOpts.includes(view.threads)
			? view.threads
			: threadOpts.includes(DEFAULT_THREADS)
				? DEFAULT_THREADS
				: (threadOpts[0] ?? null);
	const numa = view.numa ?? hardwareNumaOptions(ds, solution, machines, date);
	return { solution, machines, machine: machines[0] ?? null, date, numa, threads };
}

/** The run to use for one machine under the setup (section 5's rule when several nodes match). */
function machineRun(ds: Dataset, setup: HardwareSetup, machine: string) {
	return pickRun(ds, setup.solution ?? '', { ...setup, machine });
}

/** Does this setup leave the machine with a usable run? */
export function machineHasResults(ds: Dataset, setup: HardwareSetup, machine: string): boolean {
	const run = machineRun(ds, setup, machine).run;
	return !!run && measurement(run, setup) !== null;
}

export function resolveHardware(ds: Dataset, view: View): Resolved {
	const setup = hardwareSetup(ds, view);
	const styles = machineStyleMap(ds);
	const styleOf = (m: string) => styles.get(m) ?? styleFor(0);
	const solution = setup.solution ?? '';
	const notices: string[] = [];

	const compared: Series[] = [];
	const failed: FailedSeries[] = [];
	let multiRun = 0;
	for (const machine of setup.machines) {
		const { run, candidates } = machineRun(ds, setup, machine);
		if (!run) continue;
		if (candidates > 1) multiRun++;
		const tip = machineTip(machine, ds.machines[machine]!);
		const m = measurement(run, setup);
		if (run.exit_code !== 0) {
			failed.push({ id: machine, label: machine, style: styleOf(machine), exitCode: run.exit_code, tip });
		} else if (m) {
			compared.push({ id: machine, label: machine, style: styleOf(machine), solution, run, m, tip });
		}
	}
	if (multiRun > 0) {
		notices.push(
			`${multiRun} ${multiRun === 1 ? 'machine has' : 'machines have'} runs on several NUMA nodes; using node "all" where present, otherwise the lowest node.`
		);
	}

	const baselineChoice = view.baseline ?? HARDWARE_DEFAULT_BASELINE;
	let candidate: Series | null = null;
	if (ds.machines[baselineChoice]) {
		const run = machineRun(ds, setup, baselineChoice).run;
		const m = run ? measurement(run, setup) : null;
		if (run && m) {
			candidate = {
				id: baselineChoice,
				label: baselineChoice,
				style: styleOf(baselineChoice),
				solution,
				run,
				m,
				tip: machineTip(baselineChoice, ds.machines[baselineChoice]!)
			};
		}
	}
	const { baseline, notice } = chooseBaseline(baselineChoice, baselineChoice, candidate, compared);
	if (notice) notices.push(notice);

	const baselineOptions: BaselineOption[] = Object.keys(ds.machines)
		.sort(compareNames)
		.map((m) => ({ id: m, label: m, hasResults: machineHasResults(ds, setup, m) }));

	return {
		setup,
		compared,
		failed,
		baseline,
		baselineChoice,
		...resolveQueries(ds, view),
		notices,
		styles,
		ordering: 'score',
		baselineOptions,
		emptyReason: null
	};
}
