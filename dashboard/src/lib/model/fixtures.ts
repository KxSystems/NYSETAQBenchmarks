import type { Dataset, QueryMeta, Run, Times } from '../data/types';
import { styleFor } from './colours';
import type { Series } from './series';

/** Build a Series from `{ idx: [cold, warm1, warm2] | ns }` and optional statuses. */
export function mkSeries(
	id: string,
	times: Record<number, Times | number>,
	status: Record<number, string> = {},
	load: Record<string, number> = {}
): Series {
	const query_ns: Record<string, Times> = {};
	for (const [k, v] of Object.entries(times)) query_ns[k] = typeof v === 'number' ? [v, v, v] : v;
	const query_status: Record<string, string> = {};
	for (const [k, v] of Object.entries(status)) query_status[k] = v;
	const run: Run = {
		solution: id,
		machine: 'M',
		datadate: '2026-04-01',
		numa_node: 'all',
		test_date: '2026-04-02',
		engine_version: null,
		exit_code: 0,
		data_size_mb: null,
		peak_memory_kb: null,
		threads: {}
	};
	return { id, label: id, style: styleFor(0), solution: id, run, m: { load_ns: load, query_ns, query_status } };
}

export function mkQueries(n: number, patch: (i: number) => Partial<QueryMeta> = () => ({})): QueryMeta[] {
	return Array.from({ length: n }, (_, k) => ({
		idx: k + 1,
		description: `query ${k + 1}`,
		tags: [],
		instrument: 'all',
		complexity: 'simple',
		...patch(k + 1)
	}));
}

/** A small dataset: two machines, three solutions, one failed run, one multi-NUMA solution. */
export function mkDataset(): Dataset {
	const meas = (q: Record<string, Times>, status?: Record<string, string>) => ({
		load_ns: { load: 1e9 },
		query_ns: q,
		query_status: status
	});
	const run = (p: Partial<Run> & Pick<Run, 'solution'>): Run => ({
		machine: 'A',
		datadate: '2026-04-01',
		numa_node: '0',
		test_date: '2026-04-02',
		engine_version: null,
		exit_code: 0,
		data_size_mb: 1024,
		peak_memory_kb: 1024 * 1024,
		threads: {},
		...p
	});
	return {
		schema_version: 1,
		size: 'full',
		generated_at: '2026-10-25T00:00:00Z',
		load_phases: ['load', 'transform', 'sort', 'index'],
		tags: { pivot: 'pivots', sort: 'sorts' },
		queries: mkQueries(4, (i) => ({
			instrument: i === 1 ? 'single:frequent' : i === 2 ? 'multi:50' : i === 3 ? 'all' : 'single:infrequent',
			complexity: i === 4 ? 'complex' : 'simple',
			tags: i === 2 ? ['pivot'] : []
		})),
		solutions: {
			'KDB-X': { engine: 'q-sql', language: 'q', open_source: false, sort_columns: ['time'], query_text: {} },
			Pandas: { engine: 'pandas', language: 'python', open_source: true, sort_columns: ['time'], query_text: {} },
			'DuckDB (Index)': { engine: 'duckdb_con', language: 'sql', open_source: true, sort_columns: ['sym', 'time'], query_text: {} }
		},
		machines: {
			A: { cpu_model: 'A', test_date: '2026-04-02', environment: {} },
			B: { cpu_model: 'B', test_date: '2026-04-02', environment: {} }
		},
		runs: [
			run({ solution: 'KDB-X', numa_node: '0', threads: { '4': meas({ '1': [1, 1, 1] }) } }),
			run({ solution: 'KDB-X', numa_node: 'all', threads: { '4': meas({ '1': [2, 2, 2] }), '16': meas({}) } }),
			run({ solution: 'Pandas', threads: { '1': meas({ '1': [4, 4, 4] }) } }),
			run({ solution: 'DuckDB (Index)', exit_code: 137, data_size_mb: null, peak_memory_kb: null }),
			run({ solution: 'KDB-X', machine: 'B', threads: { '32': meas({ '1': [5, 5, 5] }) } })
		]
	};
}

/**
 * A dataset shaped like the real `large` file: two machines, a solution measured at several thread
 * counts pinned to node 0 plus 128 threads unpinned, a solution with the same count under two
 * nodes, a solution that failed on one machine and one that only failed.
 */
export function mkScalingDataset(): Dataset {
	const meas = (...idx: number[]) => {
		const query_ns: Record<string, Times> = {};
		for (const i of idx) query_ns[String(i)] = [i * 100, i * 100, i * 100];
		return { load_ns: { load: 1e9, sort: 2e9 }, query_ns };
	};
	const threads = (...ts: number[]) => Object.fromEntries(ts.map((t) => [String(t), meas(1, 2, 3, 4)]));
	const run = (p: Partial<Run> & Pick<Run, 'solution' | 'machine'>): Run => ({
		datadate: '2026-04-01',
		numa_node: '0',
		test_date: '2026-04-02',
		engine_version: null,
		exit_code: 0,
		data_size_mb: 2048,
		peak_memory_kb: 4 * 1024 * 1024,
		threads: {},
		...p
	});
	const AMD = 'AMD_EPYC_9575F';
	const INTEL = 'INTEL_XEON_6738P';
	const sol = (lang: string) => ({ engine: lang, language: lang, open_source: false, sort_columns: ['time'], query_text: { '1': `${lang} q1` } });
	return {
		schema_version: 1,
		size: 'large',
		generated_at: '2026-10-25T00:00:00Z',
		load_phases: ['load', 'transform', 'sort', 'index'],
		tags: {},
		queries: mkQueries(4),
		solutions: { 'KDB-X': sol('q'), Pandas: sol('python'), pykx: sol('python'), Broken: sol('sql') },
		machines: {
			[INTEL]: { cpu_model: 'Intel', test_date: '2026-04-02', environment: { os: { name: 'Linux' }, cpu: { Arch: 'x86_64' } } },
			[AMD]: { cpu_model: 'AMD', test_date: '2026-04-02', environment: { os: { name: 'Linux' } } }
		},
		runs: [
			run({ solution: 'KDB-X', machine: AMD, threads: threads(1, 4, 16, 64) }),
			run({ solution: 'KDB-X', machine: AMD, numa_node: 'all', peak_memory_kb: 5 * 1024 * 1024, threads: threads(128) }),
			run({ solution: 'KDB-X', machine: INTEL, threads: threads(1, 4, 16, 32, 64) }),
			run({ solution: 'KDB-X', machine: INTEL, numa_node: 'all', threads: threads(128) }),
			run({ solution: 'pykx', machine: AMD, threads: threads(64, 128) }),
			run({ solution: 'pykx', machine: AMD, numa_node: 'all', threads: threads(128) }),
			run({ solution: 'Pandas', machine: AMD, exit_code: 137, data_size_mb: null, peak_memory_kb: null }),
			run({ solution: 'Pandas', machine: INTEL, threads: threads(4) }),
			run({ solution: 'Broken', machine: AMD, exit_code: 137, data_size_mb: null, peak_memory_kb: null })
		]
	};
}
