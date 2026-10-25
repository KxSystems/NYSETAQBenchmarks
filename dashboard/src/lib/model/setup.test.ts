import { describe, expect, it } from 'vitest';
import { defaultView } from '../state/view';
import { mkDataset } from './fixtures';
import { resolve } from './series';
import { dateOptions, effectiveSetup, machineOptions, numaOptions, pickRun, threadOptions } from './setup';

const ds = mkDataset();

describe('setup options', () => {
	it('orders machines by successful runs', () => {
		expect(machineOptions(ds)).toEqual(['A', 'B']);
	});
	it('lists dates, NUMA nodes (numbers first, then all) and thread counts', () => {
		expect(dateOptions(ds, 'A')).toEqual(['2026-04-01']);
		expect(numaOptions(ds, 'A', '2026-04-01')).toEqual(['0', 'all']);
		expect(threadOptions(ds, 'A', '2026-04-01')).toEqual(['1', '4', '16']);
		expect(threadOptions(ds, 'B', '2026-04-01')).toEqual(['32']);
	});
});

describe('effectiveSetup', () => {
	it('defaults: most successful runs machine, latest date, all nodes, 4 threads', () => {
		expect(effectiveSetup(ds, defaultView())).toEqual({
			machine: 'A',
			date: '2026-04-01',
			numa: ['0', 'all'],
			threads: '4'
		});
	});
	it('falls back to the smallest thread count when 4 is not measured', () => {
		const v = defaultView();
		v.machine = 'B';
		expect(effectiveSetup(ds, v).threads).toBe('32');
	});
	it('falls back when a choice is invalid', () => {
		const v = defaultView();
		v.machine = 'nope';
		v.date = '1999-01-01';
		v.threads = '999';
		expect(effectiveSetup(ds, v)).toMatchObject({ machine: 'A', date: '2026-04-01', threads: '4' });
	});
	it('keeps valid choices', () => {
		const v = defaultView();
		v.threads = '16';
		v.numa = ['0'];
		expect(effectiveSetup(ds, v)).toMatchObject({ threads: '16', numa: ['0'] });
	});
});

describe('pickRun', () => {
	it('prefers node all, otherwise the lowest node', () => {
		const setup = effectiveSetup(ds, defaultView());
		expect(pickRun(ds, 'KDB-X', setup)).toMatchObject({ candidates: 2, run: { numa_node: 'all' } });
		expect(pickRun(ds, 'KDB-X', { ...setup, numa: ['0'] }).run?.numa_node).toBe('0');
	});
	it('needs the thread count unless the run failed', () => {
		const setup = { ...effectiveSetup(ds, defaultView()), threads: '16' };
		expect(pickRun(ds, 'Pandas', setup).run).toBeNull();
		expect(pickRun(ds, 'DuckDB (Index)', setup).run?.exit_code).toBe(137);
	});
});

describe('resolve', () => {
	it('splits compared and failed solutions and notes multiple NUMA runs', () => {
		const v = defaultView();
		v.solutions = ['KDB-X', 'Pandas', 'DuckDB (Index)'];
		v.threads = '4';
		const r = resolve(ds, v);
		expect(r.compared.map((s) => s.id)).toEqual(['KDB-X']); // Pandas has no 4-thread data
		expect(r.failed).toEqual([expect.objectContaining({ id: 'DuckDB (Index)', exitCode: 137 })]);
		expect(r.notices.join(' ')).toMatch(/NUMA/);
		expect(r.compared[0]!.run.numa_node).toBe('all');
	});
	it('uses the chosen baseline even when it is not selected or filtered out', () => {
		const v = defaultView();
		v.solutions = ['Pandas'];
		v.threads = '4';
		const withPandas = structuredClone(ds);
		const pandas = withPandas.runs.find((r) => r.solution === 'Pandas')!;
		pandas.threads['4'] = pandas.threads['1']!;
		const r = resolve(withPandas, v);
		expect(r.compared.map((s) => s.id)).toEqual(['Pandas']);
		expect(r.baseline?.id).toBe('KDB-X');
		expect(r.notices.join(' ')).not.toMatch(/baseline/);
		v.openSource = ['yes']; // KDB-X is proprietary
		expect(resolve(withPandas, v).baseline?.id).toBe('KDB-X');
	});
	it('substitutes the first compared solution when the baseline has no results', () => {
		const v = defaultView();
		v.solutions = ['Pandas'];
		v.threads = '1';
		const r = resolve(ds, v);
		expect(r.baseline?.id).toBe('Pandas');
		expect(r.baselineChoice).toBe('KDB-X');
		expect(r.notices.join(' ')).toMatch(/KDB-X has no results for this setup; using Pandas as the baseline/);
	});
	it('applies the open-source and sort-column filters', () => {
		const v = defaultView();
		v.solutions = ['KDB-X', 'Pandas'];
		v.threads = '4';
		v.openSource = ['yes'];
		expect(resolve(ds, v).compared).toEqual([]);
		v.openSource = null;
		v.sortCols = ['sym-time'];
		expect(resolve(ds, v).compared).toEqual([]);
	});
	it('removes unticked queries from the compared queries', () => {
		const v = defaultView();
		v.unticked = [2, 3];
		const r = resolve(ds, v);
		expect(r.queries.length).toBe(4);
		expect(r.comparedQueries.map((q) => q.idx)).toEqual([1, 4]);
	});
	it('has nothing to compare when no solution is selected', () => {
		const v = defaultView();
		v.solutions = [];
		const r = resolve(ds, v);
		expect(r.compared).toEqual([]);
		expect(r.failed).toEqual([]);
	});
});
