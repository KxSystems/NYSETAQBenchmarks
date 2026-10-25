import { describe, expect, it } from 'vitest';
import { canonicalHardware } from '../state/canonical';
import { defaultView } from '../state/view';
import { mkScalingDataset } from './fixtures';
import { hardwareDateOptions, hardwareMachineOptions, hardwareSetup, machineStyleMap, resolveHardware } from './hardware';

const ds = mkScalingDataset();
const AMD = 'AMD_EPYC_9575F';
const INTEL = 'INTEL_XEON_6738P';
const view = (patch = {}) => ({ ...defaultView('large'), ...patch });

describe('hardware page defaults', () => {
	it('selects KDB-X, every machine with a run, the latest date and 4 threads', () => {
		const s = hardwareSetup(ds, view());
		expect(s).toMatchObject({ solution: 'KDB-X', machines: [AMD, INTEL], date: '2026-04-01', threads: '4' });
		expect(s.numa).toEqual(['0', 'all']);
	});
	it('falls back to the first solution alphabetically when KDB-X has no runs, and to the smallest thread count', () => {
		const noKdb = { ...ds, runs: ds.runs.filter((r) => r.solution !== 'KDB-X') };
		expect(hardwareSetup(noKdb, view()).solution).toBe('Broken');
		expect(hardwareSetup(ds, view({ solution: 'pykx' })).threads).toBe('64'); // pykx has no 4: smallest measured
	});
	it('lists machines with runs of the solution, alphabetically', () => {
		expect(hardwareMachineOptions(ds, 'Pandas')).toEqual([AMD, INTEL]);
		expect(hardwareMachineOptions(ds, 'pykx')).toEqual([AMD]);
		expect(hardwareDateOptions(ds, 'KDB-X', [AMD])).toEqual(['2026-04-01']);
	});
	it('ignores an invalid solution', () => {
		expect(hardwareSetup(ds, view({ solution: 'Nope' })).solution).toBe('KDB-X');
	});
});

describe('hardware series', () => {
	it('has one series per machine, labelled and coloured by machine', () => {
		const r = resolveHardware(ds, view());
		expect(r.compared.map((s) => s.id)).toEqual([AMD, INTEL]);
		expect(r.compared.map((s) => s.label)).toEqual([AMD, INTEL]);
		expect(r.compared.every((s) => s.solution === 'KDB-X')).toBe(true);
		const styles = machineStyleMap(ds);
		expect(styles.get(AMD)!.index).toBe(0); // alphabetical over all machines
		expect(styles.get(INTEL)!.index).toBe(1);
		expect(r.ordering).toBe('score');
	});
	it('picks one run per machine: node all if present, else the lowest, and says so', () => {
		const r = resolveHardware(ds, view({ solution: 'pykx', threads: '128' }));
		expect(r.compared).toHaveLength(1);
		expect(r.compared[0]!.run.numa_node).toBe('all');
		expect(r.notices.join(' ')).toMatch(/runs on several NUMA nodes/);
		expect(resolveHardware(ds, view({ threads: '4' })).compared.map((s) => s.run.numa_node)).toEqual(['0', '0']);
	});
	it('carries the machine specification as the tooltip', () => {
		const tip = resolveHardware(ds, view()).compared[0]!.tip!;
		expect(tip.title).toBe(AMD);
		expect(tip.groups?.map((g) => g.heading)).toEqual(['os']);
	});
	it('lists a machine whose run failed as failed', () => {
		const r = resolveHardware(ds, view({ solution: 'Pandas' }));
		expect(r.compared.map((s) => s.id)).toEqual([INTEL]);
		expect(r.failed).toEqual([expect.objectContaining({ id: AMD, exitCode: 137 })]);
	});
	it('leaves out a machine without a run for the thread count', () => {
		const r = resolveHardware(ds, view({ threads: '32' }));
		expect(r.compared.map((s) => s.id)).toEqual([INTEL]);
		expect(r.baselineOptions.find((o) => o.id === AMD)!.hasResults).toBe(false);
		expect(r.baselineOptions.find((o) => o.id === INTEL)!.hasResults).toBe(true);
	});
	it('only compares the selected machines', () => {
		expect(resolveHardware(ds, view({ machines: [INTEL] })).compared.map((s) => s.id)).toEqual([INTEL]);
		expect(resolveHardware(ds, view({ machines: [] })).compared).toEqual([]);
	});
});

describe('hardware baseline', () => {
	it('defaults to AMD_EPYC_9575F', () => {
		const r = resolveHardware(ds, view());
		expect(r.baselineChoice).toBe(AMD);
		expect(r.baseline!.id).toBe(AMD);
		expect(r.notices).toEqual([]);
	});
	it('uses the first compared machine, with a notice, when the baseline has no results; the choice is kept', () => {
		const r = resolveHardware(ds, view({ threads: '32' }));
		expect(r.baselineChoice).toBe(AMD);
		expect(r.baseline!.id).toBe(INTEL);
		expect(r.notices.join(' ')).toContain(`${AMD} has no results for this setup; using ${INTEL} as the baseline`);
	});
	it('accepts a baseline machine that is not selected', () => {
		const r = resolveHardware(ds, view({ machines: [INTEL] }));
		expect(r.baseline!.id).toBe(AMD);
		expect(r.compared.map((s) => s.id)).toEqual([INTEL]);
	});
	it('takes a chosen machine as baseline', () => {
		expect(resolveHardware(ds, view({ baseline: INTEL })).baseline!.id).toBe(INTEL);
	});
});

describe('hardware canonical view', () => {
	it('stores defaults as null and drops invalid choices', () => {
		const c = canonicalHardware(ds, view({ solution: 'KDB-X', machines: [AMD, INTEL], threads: '4', baseline: AMD, date: '2026-04-01' }));
		expect(c).toMatchObject({ solution: null, machines: null, threads: null, baseline: null, date: null });
		const d = canonicalHardware(ds, view({ solution: 'pykx', machines: [INTEL], threads: '999', baseline: 'Nope', highlight: 'Nope' }));
		expect(d.solution).toBe('pykx');
		expect(d.machines).toBeNull(); // INTEL has no pykx run: back to all
		expect(d.threads).toBeNull();
		expect(d.baseline).toBeNull();
		expect(d.highlight).toBeNull();
	});
	it('keeps an explicit empty machine selection', () => {
		expect(canonicalHardware(ds, view({ machines: [] })).machines).toEqual([]);
	});
});
