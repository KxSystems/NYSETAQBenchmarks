import { describe, expect, it } from 'vitest';
import { canonicalThreads } from '../state/canonical';
import { defaultView } from '../state/view';
import { mkScalingDataset, mkSeries } from './fixtures';
import { linearScalingScore, memoryNote, pairId, parsePairId, resolveThreads, threadsMachineOptions, threadsSetup } from './threads';

const ds = mkScalingDataset();
const AMD = 'AMD_EPYC_9575F';
const INTEL = 'INTEL_XEON_6738P';
const view = (patch = {}) => ({ ...defaultView('large'), ...patch });
const labels = (v = view()) => resolveThreads(ds, v).compared.map((s) => s.label);

describe('thread scaling defaults', () => {
	it('selects KDB-X and the machine with the most measured thread counts', () => {
		expect(threadsMachineOptions(ds, 'KDB-X')).toEqual([INTEL, AMD]); // 6 thread counts vs 5
		const s = threadsSetup(ds, view());
		expect(s).toMatchObject({ solution: 'KDB-X', machine: INTEL, date: '2026-04-01' });
		expect(s.numa).toEqual(['0', 'all']);
	});
	it('selects every available pair', () => {
		const r = resolveThreads(ds, view());
		expect(r.compared).toHaveLength(6);
		expect(r.baselineChoice).toBe('1@0');
	});
});

describe('thread-count series across NUMA nodes', () => {
	it('builds pairs from every run on the machine, ascending by thread count', () => {
		expect(resolveThreads(ds, view({ machine: AMD })).compared.map((s) => s.id)).toEqual(['1@0', '4@0', '16@0', '64@0', '128@all']);
		expect(labels(view({ machine: AMD }))).toEqual(['1 thread', '4 threads', '16 threads', '64 threads', '128 threads']);
		expect(resolveThreads(ds, view()).compared.map((s) => s.sortKey)).toEqual([1, 4, 16, 32, 64, 128]);
	});
	it('adds the node to the label when a thread count appears under several nodes', () => {
		const r = resolveThreads(ds, view({ solution: 'pykx', machine: AMD }));
		expect(r.compared.map((s) => s.id)).toEqual(['64@0', '128@0', '128@all']);
		expect(r.compared.map((s) => s.label)).toEqual(['64 threads', '128 threads (node 0)', '128 threads (all nodes)']);
	});
	it('marks a pair whose node differs from the others in its tooltip', () => {
		const r = resolveThreads(ds, view({ machine: AMD }));
		const tips = Object.fromEntries(r.compared.map((s) => [s.id, s.tip!.lines!.join(' | ')]));
		expect(tips['128@all']).toContain('ran unpinned, on all NUMA nodes');
		expect(tips['16@0']).not.toContain('ran');
		const single = resolveThreads(ds, view({ machine: AMD, numa: ['0'] }));
		expect(single.compared.every((s) => !s.tip!.lines!.join(' ').includes('ran'))).toBe(true);
	});
	it('lets the NUMA node filter decide which runs contribute pairs', () => {
		expect(resolveThreads(ds, view({ machine: AMD, numa: ['all'] })).compared.map((s) => s.id)).toEqual(['128@all']);
		expect(resolveThreads(ds, view({ machine: AMD, numa: [] })).compared).toEqual([]);
	});
	it('takes the measurements of the right run and thread count', () => {
		const s = resolveThreads(ds, view({ machine: AMD })).compared.find((x) => x.id === '128@all')!;
		expect(s.run.numa_node).toBe('all');
		expect(s.m).toBe(s.run.threads['128']);
	});
	it('restricts to the selected pairs', () => {
		expect(resolveThreads(ds, view({ pairs: ['4@0', '64@0'] })).compared.map((s) => s.id)).toEqual(['4@0', '64@0']);
	});
	it('parses and builds pair ids', () => {
		expect(pairId(64, '0')).toBe('64@0');
		expect(parsePairId('128@all')).toEqual({ threads: 128, node: 'all' });
		expect(parsePairId('x')).toBeNull();
	});
});

describe('thread scaling presentation', () => {
	it('keeps ascending thread order and uses the sequential scale, lightest for the fewest threads', () => {
		const r = resolveThreads(ds, view());
		expect(r.ordering).toBe('natural');
		const seq = r.compared.map((s) => s.style.seq!);
		expect(seq[0]).toBe(0);
		expect(seq[seq.length - 1]).toBe(1);
		expect(seq).toEqual([...seq].sort((a, b) => a - b));
	});
	it('keeps a pair colour stable when other pairs are deselected', () => {
		const all = resolveThreads(ds, view()).styles.get('16@0');
		const some = resolveThreads(ds, view({ pairs: ['16@0'] })).compared[0]!.style;
		expect(some).toEqual(all);
	});
	it('describes the peak memory and data size per run', () => {
		const note = memoryNote(resolveThreads(ds, view({ machine: AMD })).compared);
		expect(note).toBe('Peak memory 4.0 GB and data size 2.0 GB (node 0 run); 5.0 GB and 2.0 GB (unpinned run)');
		const one = memoryNote(resolveThreads(ds, view({ machine: AMD, numa: ['0'] })).compared);
		expect(one).toBe('Peak memory 4.0 GB and data size 2.0 GB (node 0 run)');
		expect(memoryNote([])).toBeNull();
		const na = mkSeries('x', {});
		expect(memoryNote([na])).toBe('Peak memory n/a GB and data size n/a GB (unpinned run)');
	});
	it('computes ideal linear scaling from the baseline thread count', () => {
		expect(linearScalingScore(1, 16)).toBe(1 / 16);
		expect(linearScalingScore(4, 64)).toBe(0.0625);
		expect(linearScalingScore(4, 4)).toBe(1);
	});
});

describe('thread scaling baseline', () => {
	it('defaults to the smallest compared thread count', () => {
		expect(resolveThreads(ds, view({ pairs: ['16@0', '4@0'] })).baseline!.id).toBe('4@0');
	});
	it('uses a chosen pair, even when it is not selected', () => {
		const r = resolveThreads(ds, view({ pairs: ['16@0'], baseline: '64@0' }));
		expect(r.baseline!.id).toBe('64@0');
		expect(r.compared.map((s) => s.id)).toEqual(['16@0']);
	});
	it('falls back to the first compared pair with a notice when the choice is unavailable; the choice is kept', () => {
		const r = resolveThreads(ds, view({ machine: AMD, baseline: '32@0' }));
		expect(r.baselineChoice).toBe('32@0');
		expect(r.baseline!.id).toBe('1@0');
		expect(r.notices.join(' ')).toContain('has no results for this setup; using 1 thread as the baseline');
	});
	it('offers every available pair as baseline', () => {
		expect(resolveThreads(ds, view({ machine: AMD })).baselineOptions.map((o) => o.id)).toEqual(['1@0', '4@0', '16@0', '64@0', '128@all']);
	});
});

describe('thread scaling with failed runs', () => {
	it('contributes no series and explains the failure when every run failed', () => {
		const r = resolveThreads(ds, view({ solution: 'Broken' }));
		expect(r.compared).toEqual([]);
		expect(r.failed).toEqual([]);
		expect(r.emptyReason).toBe('Broken failed on this machine: exit 137');
	});
	it('has no empty reason when there are series', () => {
		expect(resolveThreads(ds, view()).emptyReason).toBeNull();
		expect(resolveThreads(ds, view({ solution: 'Pandas', machine: AMD })).emptyReason).toBe('Pandas failed on this machine: exit 137');
		expect(resolveThreads(ds, view({ solution: 'Pandas' })).compared.map((s) => s.id)).toEqual(['4@0']);
	});
});

describe('thread scaling canonical view', () => {
	it('stores defaults as null and drops invalid pairs', () => {
		const c = canonicalThreads(ds, view({ machine: INTEL, pairs: ['1@0', '4@0', '16@0', '32@0', '64@0', '128@all'], solution: 'KDB-X' }));
		expect(c).toMatchObject({ machine: null, pairs: null, solution: null });
		const d = canonicalThreads(ds, view({ machine: AMD, pairs: ['1@0', '32@0'] }));
		expect(d.machine).toBe(AMD);
		expect(d.pairs).toEqual(['1@0']);
		expect(canonicalThreads(ds, view({ machine: AMD, pairs: ['32@0'] })).pairs).toBeNull();
		expect(canonicalThreads(ds, view({ baseline: 'garbage' })).baseline).toBeNull();
	});
});
