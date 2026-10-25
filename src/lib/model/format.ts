/** Display formats of spec section 5. */

/** Seconds with three decimals; below 1 ms, milliseconds with two. */
export function formatTime(ns: number): string {
	if (ns < 1e6) return `${(ns / 1e6).toFixed(2)}ms`;
	return `${(ns / 1e9).toFixed(3)}s`;
}

/** Time in words for accessible labels. */
export function formatTimeSpoken(ns: number): string {
	if (ns < 1e6) return `${(ns / 1e6).toFixed(2)} milliseconds`;
	return `${(ns / 1e9).toFixed(3)} seconds`;
}

/** `×1.00`, `2.15× slower`, `3.40× faster`. */
export function formatRatio(r: number): string {
	if (r.toFixed(2) === '1.00') return '×1.00';
	if (r > 1) return `${r.toFixed(2)}× slower`;
	return `${(1 / r).toFixed(2)}× faster`;
}

/** Compact table form: `×2.15`, `×0.29`. */
export function formatRatioCompact(r: number): string {
	return `×${r.toFixed(2)}`;
}

/** Spoken form: "1.32 times slower than KDB-X". */
export function formatRatioSpoken(r: number, baseline: string): string {
	if (r.toFixed(2) === '1.00') return `the same as ${baseline}`;
	if (r > 1) return `${r.toFixed(2)} times slower than ${baseline}`;
	return `${(1 / r).toFixed(2)} times faster than ${baseline}`;
}

/** `1 thread`, `4 threads`. */
export function threadsLabel(n: string | number | null): string {
	if (n === null) return '? threads';
	return `${n} ${Number(n) === 1 ? 'thread' : 'threads'}`;
}

/** Peak memory in GB (kB / 1024²). */
export function kbToGB(kb: number): number {
	return kb / 1024 / 1024;
}

/** Data size in GB (MB / 1024). */
export function mbToGB(mb: number): number {
	return mb / 1024;
}

export function formatGB(gb: number): string {
	return gb.toFixed(1);
}

/** `['sym','time']` → `Sym, Time`. */
export function sortColumnsLabel(cols: readonly string[]): string {
	return cols.map((c) => c.charAt(0).toUpperCase() + c.slice(1)).join(', ');
}

/** Stable key for a sort_columns value (used in the URL). */
export function sortColumnsKey(cols: readonly string[] | null): string {
	return cols && cols.length ? cols.join('-') : 'unknown';
}

/** `1000infreq` → `1000 infreq` for display. */
export function instrumentRefinementLabel(ref: string): string {
	return ref.replace(/^(\d+)(?=[a-z])/i, '$1 ');
}

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/** Alphabetical, case-insensitive, numbers sorted numerically. */
export function compareNames(a: string, b: string): number {
	return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}
