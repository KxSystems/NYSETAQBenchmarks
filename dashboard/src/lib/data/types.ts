/** Shapes of the dashboard data files (inputs/schema.md). Times are ns, memory kB, sizes MB. */

export interface QueryMeta {
	idx: number;
	description: string;
	tags: string[];
	instrument: string;
	complexity: string;
	comment?: string;
}

export interface SolutionMeta {
	engine: string | null;
	language: string | null;
	open_source: boolean | null;
	sort_columns: string[] | null;
	query_text: Record<string, string>;
}

export interface MachineMeta {
	cpu_model: string;
	test_date: string;
	environment: Record<string, unknown>;
}

export type Times = [cold: number, warm1: number, warm2: number];

export interface ThreadMeasurement {
	load_ns: Record<string, number>;
	query_ns: Record<string, Times>;
	query_status?: Record<string, string>;
}

export interface Run {
	solution: string;
	machine: string;
	datadate: string;
	numa_node: string;
	test_date: string;
	engine_version: string | null;
	exit_code: number;
	data_size_mb: number | null;
	peak_memory_kb: number | null;
	threads: Record<string, ThreadMeasurement>;
}

export interface Dataset {
	schema_version: number;
	size: string;
	generated_at: string;
	load_phases: string[];
	tags: Record<string, string>;
	queries: QueryMeta[];
	solutions: Record<string, SolutionMeta>;
	machines: Record<string, MachineMeta>;
	runs: Run[];
}

/** The three consecutive executions of a query. */
export type Timing = 'cold' | 'hot' | 'hot2';
export const TIMINGS: readonly Timing[] = ['cold', 'hot', 'hot2'];
export const TIMING_INDEX: Record<Timing, 0 | 1 | 2> = { cold: 0, hot: 1, hot2: 2 };
export const TIMING_LABEL: Record<Timing, string> = {
	cold: 'Cold run',
	hot: 'Hot run',
	hot2: 'Second hot run'
};
