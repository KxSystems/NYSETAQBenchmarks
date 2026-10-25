import { describe, expect, it } from 'vitest';
import { linksFor } from '../config/pages';
import { parseView, serializeView } from '../state/url';
import { defaultView } from '../state/view';
import { mkScalingDataset } from './fixtures';
import { hardwareLogic, solutionsLogic, threadsLogic } from './pages';

const ds = mkScalingDataset();

describe('page defaults', () => {
	it('the main page keeps its defaults', () => {
		expect(solutionsLogic.defaultSize).toBe('full');
		expect(solutionsLogic.defaultView()).toEqual(defaultView());
		expect(solutionsLogic.memory).toBe('charts');
		expect(solutionsLogic.seriesNoun).toEqual(['solution', 'solutions']);
	});
	it('the hardware and thread-scaling pages default to the large data size', () => {
		for (const p of [hardwareLogic, threadsLogic]) {
			expect(p.defaultSize).toBe('large');
			expect(p.defaultView().size).toBe('large');
		}
	});
	it('thread scaling replaces the memory charts with a note', () => {
		expect(threadsLogic.memory).toBe('note');
		expect(hardwareLogic.memory).toBe('charts');
	});
	it('orders by score on the main and hardware pages and by thread count on thread scaling', () => {
		expect(solutionsLogic.resolve(ds, defaultView('large')).ordering).toBe('score');
		expect(hardwareLogic.resolve(ds, hardwareLogic.defaultView()).ordering).toBe('score');
		expect(threadsLogic.resolve(ds, threadsLogic.defaultView()).ordering).toBe('natural');
	});
});

describe('status text and chips', () => {
	it('hardware: names the solution and the machines', () => {
		const v = hardwareLogic.defaultView();
		const r = hardwareLogic.resolve(ds, v);
		expect(hardwareLogic.statusText(ds, v, r)).toBe(
			'Comparing KDB-X on 2 machines on 4 of 4 queries · large · 2026-04-01 · 4 threads · cold run · baseline AMD_EPYC_9575F'
		);
		expect(hardwareLogic.chips(ds, v, r).map((c) => c.text)).toEqual(['KDB-X', '2 machines', 'large', '4 threads', 'Cold run', '4/4 queries']);
		const load = { ...v, tab: 'load' as const };
		expect(hardwareLogic.statusText(ds, load, r)).toBe('Comparing KDB-X on 2 machines · large · 2026-04-01 · 4 threads · load times · baseline AMD_EPYC_9575F');
	});
	it('hardware: counts a failed machine', () => {
		const v = { ...hardwareLogic.defaultView(), solution: 'Pandas' };
		expect(hardwareLogic.statusText(ds, v, hardwareLogic.resolve(ds, v))).toContain('Comparing Pandas on 1 machine (+1 failed)');
	});
	it('threads: names the solution, machine and number of thread counts', () => {
		const v = threadsLogic.defaultView();
		const r = threadsLogic.resolve(ds, v);
		expect(threadsLogic.statusText(ds, v, r)).toBe(
			'KDB-X on INTEL_XEON_6738P at 6 thread counts on 4 of 4 queries · large · 2026-04-01 · cold run · baseline 1 thread'
		);
		expect(threadsLogic.chips(ds, v, r).map((c) => c.text)).toEqual([
			'KDB-X',
			'INTEL_XEON_6738P',
			'large',
			'6 thread counts',
			'Cold run',
			'4/4 queries'
		]);
	});
	it('threads: the timing and query chips are n/a on the load tab', () => {
		const v = { ...threadsLogic.defaultView(), tab: 'load' as const };
		const chips = threadsLogic.chips(ds, v, threadsLogic.resolve(ds, v));
		expect(chips.filter((c) => c.dim).map((c) => c.text)).toEqual(['n/a on this tab', 'queries n/a on this tab']);
	});
});

describe('removing a series', () => {
	it('deselects a machine', () => {
		const v = hardwareLogic.defaultView();
		expect(hardwareLogic.removeSeries(ds, v, 'AMD_EPYC_9575F')).toEqual({ machines: ['INTEL_XEON_6738P'] });
	});
	it('deselects a thread-count pair', () => {
		const v = { ...threadsLogic.defaultView(), pairs: ['1@0', '4@0', '16@0'] };
		expect(threadsLogic.removeSeries(ds, v, '4@0')).toEqual({ pairs: ['1@0', '16@0'] });
	});
});

describe('URL parameters per page', () => {
	it('omit the page default size and keep other sizes', () => {
		expect(serializeView(hardwareLogic.defaultView(), 'large')).toBe('');
		expect(serializeView({ ...hardwareLogic.defaultView(), size: 'full' }, 'large')).toBe('?size=full');
		expect(parseView('', 'large').size).toBe('large');
		expect(parseView('?size=full', 'large').size).toBe('full');
		expect(parseView('?size=bogus', 'large').size).toBe('large');
	});
	it('round-trip the hardware parameters', () => {
		const v = { ...hardwareLogic.defaultView(), solution: 'pykx', machines: ['AMD_EPYC_9575F'], threads: '16', baseline: 'INTEL_XEON_6738P' };
		const s = serializeView(v, 'large');
		expect(s).toBe('?solution=pykx&machines=AMD_EPYC_9575F&threads=16&baseline=INTEL_XEON_6738P');
		expect(parseView(s, 'large')).toEqual(v);
	});
	it('round-trip the thread-scaling parameters', () => {
		const v = { ...threadsLogic.defaultView(), machine: 'AMD_EPYC_9575F', pairs: ['1@0', '128@all'], baseline: '4@0', scale: 'log' as const };
		const s = serializeView(v, 'large');
		expect(s).toBe('?pairs=1@0,128@all&machine=AMD_EPYC_9575F&baseline=4@0&scale=log');
		expect(parseView(s, 'large')).toEqual(v);
	});
});

describe('resource links', () => {
	it('shows the three external links, then the other pages, with the current page marked', () => {
		const main = linksFor('solutions');
		expect(main.map((l) => l.label)).toEqual([
			'Methodology and motivation',
			'Reproduce and validate results',
			'Add a solution',
			'Hardware comparison',
			'Thread scaling'
		]);
		expect(main.some((l) => l.current)).toBe(false);

		const hw = linksFor('hardware');
		expect(hw.map((l) => l.label).slice(3)).toEqual(['Solution comparison', 'Hardware comparison', 'Thread scaling']);
		expect(hw.filter((l) => l.current).map((l) => l.label)).toEqual(['Hardware comparison']);
		expect(linksFor('threads').filter((l) => l.current).map((l) => l.href)).toEqual(['/threads/']);
		expect(hw.find((l) => l.label === 'Solution comparison')).toMatchObject({ href: '/', external: false });
	});
});
