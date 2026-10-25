import { DEFAULT_SIZE, SIZES } from '../data/load';
import { TIMINGS, type Timing } from '../data/types';
import { defaultView, type View } from './view';

/**
 * Readable URL codec for `View`.
 *
 * Lists are written `a,b,c` with each element `encodeURIComponent`-escaped, because solution
 * names contain commas (`DuckDB (Sym, Time Sort)`). The raw query string is therefore split
 * on `,` before decoding. Parameters equal to the default are omitted; an absent list means
 * "default" and an empty one (`solutions=`) means "none selected".
 */

const TIMING_PARAM: Record<Timing, string> = { cold: 'cold', hot: 'hot', hot2: 'hot2' };

function dec(s: string): string {
	try {
		return decodeURIComponent(s.replace(/\+/g, ' '));
	} catch {
		return s;
	}
}

function parseList(raw: string): string[] {
	return raw === '' ? [] : raw.split(',').map(dec);
}

/** `3-5,12` → [3,4,5,12]. Invalid parts are ignored. */
export function parseRanges(raw: string): number[] {
	const out = new Set<number>();
	for (const part of raw.split(',')) {
		const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
		if (!m) continue;
		const a = Number(m[1]);
		const b = m[2] === undefined ? a : Number(m[2]);
		if (b < a || b - a > 10000) continue;
		for (let i = a; i <= b; i++) out.add(i);
	}
	return [...out].sort((x, y) => x - y);
}

/** [3,4,5,12] → `3-5,12`. */
export function formatRanges(nums: readonly number[]): string {
	const sorted = [...new Set(nums)].sort((a, b) => a - b);
	const parts: string[] = [];
	for (let i = 0; i < sorted.length; ) {
		let j = i;
		while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
		parts.push(j > i + 1 ? `${sorted[i]}-${sorted[j]}` : sorted.slice(i, j + 1).join(','));
		i = j + 1;
	}
	return parts.join(',');
}

export function parseView(search: string): View {
	const v = defaultView();
	const q = search.startsWith('?') ? search.slice(1) : search;
	const params = new Map<string, string>();
	for (const pair of q.split('&')) {
		if (!pair) continue;
		const i = pair.indexOf('=');
		const key = i < 0 ? pair : pair.slice(0, i);
		const value = i < 0 ? '' : pair.slice(i + 1);
		if (!params.has(key)) params.set(key, value);
	}
	const one = (k: string) => (params.has(k) ? dec(params.get(k)!) : null);
	const list = (k: string) => (params.has(k) ? parseList(params.get(k)!) : null);

	const size = one('size');
	if (size && (SIZES as readonly string[]).includes(size)) v.size = size;

	v.solutions = list('solutions');
	const open = list('open');
	if (open) v.openSource = open.filter((x): x is 'yes' | 'no' => x === 'yes' || x === 'no');
	v.sortCols = list('sort');
	v.machine = one('machine') || null;
	v.date = one('date') || null;
	v.numa = list('numa');
	v.threads = one('threads') || null;

	const timing = one('timing');
	if (timing && (TIMINGS as readonly string[]).includes(timing)) v.timing = timing as Timing;

	v.baseline = one('baseline') || null;
	if (one('scale') === 'log') v.scale = 'log';
	if (one('tab') === 'load') v.tab = 'load';
	v.breakdownOpen = one('bd') === '1';
	v.highlight = one('hl') || null;

	const rows = one('rows');
	if (rows) {
		const i = rows.indexOf(':');
		const kind = rows.slice(0, i);
		const series = rows.slice(i + 1);
		if (i > 0 && (kind === 'fails' || kind === 'wins') && series) v.rows = { kind, series };
	}

	if (params.has('skip')) v.unticked = parseRanges(dec(params.get('skip')!));
	v.instruments = list('inst');
	v.complexity = list('cx');
	v.includeTags = list('tags') ?? [];
	v.excludeTags = list('notags');
	return v;
}

export function serializeView(v: View): string {
	const parts: string[] = [];
	const enc = encodeURIComponent;
	const one = (k: string, val: string | null) => {
		if (val !== null && val !== '') parts.push(`${k}=${enc(val)}`);
	};
	const list = (k: string, val: readonly string[] | null) => {
		if (val !== null) parts.push(`${k}=${val.map(enc).join(',')}`);
	};

	if (v.size !== DEFAULT_SIZE) one('size', v.size);
	list('solutions', v.solutions);
	list('open', v.openSource);
	list('sort', v.sortCols);
	one('machine', v.machine);
	one('date', v.date);
	list('numa', v.numa);
	one('threads', v.threads);
	if (v.timing !== 'cold') one('timing', TIMING_PARAM[v.timing]);
	one('baseline', v.baseline);
	if (v.scale === 'log') one('scale', 'log');
	if (v.tab === 'load') one('tab', 'load');
	if (v.breakdownOpen) one('bd', '1');
	one('hl', v.highlight);
	if (v.rows) parts.push(`rows=${v.rows.kind}:${enc(v.rows.series)}`);
	if (v.unticked.length) parts.push(`skip=${formatRanges(v.unticked)}`);
	list('inst', v.instruments);
	list('cx', v.complexity);
	if (v.includeTags.length) list('tags', v.includeTags);
	list('notags', v.excludeTags);
	return parts.length ? `?${parts.join('&')}` : '';
}
