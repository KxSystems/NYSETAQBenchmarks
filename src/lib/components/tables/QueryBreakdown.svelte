<script lang="ts">
	import { BAND_LEGEND, bandOf, type Band } from '../../model/bands';
	import { FAIL_LABEL, failureReason, ratio, timeOf, winnersOf } from '../../model/calc';
	import { queryTip } from '../../model/describe';
	import {
		formatRatioCompact,
		formatRatioSpoken,
		formatTime,
		formatTimeSpoken
	} from '../../model/format';
	import { useApp } from '../../state/app.svelte';
	import { tip } from '../../state/tooltip.svelte';
	import Icon from '../ui/Icon.svelte';
	import Swatch from '../ui/Swatch.svelte';
	import QueryTextTip from './QueryTextTip.svelte';

	const app = useApp();
	const ds = $derived(app.ds!);
	const r = $derived(app.resolved!);
	const a = $derived(app.analysis!);
	const timing = $derived(app.view.timing);
	const columns = $derived(a.ordered);
	const baseline = $derived(r.baseline);
	const unticked = $derived(new Set(app.view.unticked));

	const rowsFilter = $derived(app.view.rows);
	const rows = $derived.by(() => {
		const f = rowsFilter;
		const s = f ? r.compared.find((c) => c.id === f.series) : null;
		if (!f || !s) return r.queries;
		return r.queries.filter((q) =>
			f.kind === 'fails'
				? timeOf(s, q.idx, timing) === null
				: winnersOf(r.compared, q.idx, timing).includes(s.id)
		);
	});

	const allTicked = $derived(rows.length > 0 && rows.every((q) => !unticked.has(q.idx)));
	const someTicked = $derived(rows.some((q) => !unticked.has(q.idx)));
	let headBox = $state<HTMLInputElement>();
	$effect(() => {
		if (headBox) headBox.indeterminate = someTicked && !allTicked;
	});

	function setTicked(idx: number[], ticked: boolean) {
		const set = new Set(app.view.unticked);
		for (const i of idx) ticked ? set.delete(i) : set.add(i);
		app.set({ unticked: [...set].sort((x, y) => x - y) });
	}

	// ---- cell tooltip (query text) ----
	let active = $state<string | null>(null);
	let activeEl = $state<HTMLElement | null>(null);
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	const show = (key: string, el: HTMLElement) => {
		clearTimeout(hideTimer);
		active = key;
		activeEl = el;
	};
	const hideSoon = () => {
		clearTimeout(hideTimer);
		hideTimer = setTimeout(() => (active = null), 150);
	};
	function onFocusOut(e: FocusEvent, td: HTMLElement) {
		if (e.relatedTarget instanceof Node && td.contains(e.relatedTarget)) return;
		hideSoon();
	}
	function onWindowDown(e: PointerEvent) {
		if (active && e.pointerType === 'touch' && !(e.target as HTMLElement).closest('[data-cell].active')) active = null;
	}
	function onKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape' && active) active = null;
	}

	// ---- roving focus over the cells ----
	let table = $state<HTMLTableElement>();
	let cur = $state({ r: 0, c: 0 });
	function onGridKey(e: KeyboardEvent) {
		const t = e.target as HTMLElement;
		if (!t.matches('[data-cell]')) return;
		const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
		const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
		if (!dr && !dc) return;
		e.preventDefault();
		const nr = Math.max(0, Math.min(rows.length - 1, Number(t.dataset.r) + dr));
		const nc = Math.max(0, Math.min(columns.length - 1, Number(t.dataset.c) + dc));
		cur = { r: nr, c: nc };
		table?.querySelector<HTMLElement>(`[data-r="${nr}"][data-c="${nc}"]`)?.focus();
	}

	function cellInfo(sIdx: number, q: (typeof rows)[number]) {
		const s = columns[sIdx]!;
		const t = timeOf(s, q.idx, timing);
		const isBase = s.id === baseline?.id;
		if (t === null) {
			const reason = FAIL_LABEL[failureReason(s, q.idx)];
			return { band: 'failed' as Band, label: `Q${q.idx}, ${s.id}: failed, ${reason}`, reason, time: null, ratio: null, isBase };
		}
		const base = baseline ? timeOf(baseline, q.idx, timing) : null;
		const rt = isBase ? null : ratio(t, base);
		const rel = rt === null ? '' : `, ${formatRatioSpoken(rt, baseline!.label)}`;
		return {
			band: (rt === null ? 'similar' : bandOf(rt)) as Band,
			label: `Q${q.idx}, ${s.id}: ${formatTimeSpoken(t)}${rel}`,
			reason: null,
			time: t,
			ratio: rt,
			isBase,
			plain: rt === null
		};
	}
</script>

<svelte:window onpointerdown={onWindowDown} onkeydown={onKeyDown} />

<section id="breakdown" class="breakdown" aria-labelledby="breakdown-title">
	<header>
		<h2 id="breakdown-title">Query breakdown</h2>
		<button type="button" class="btn" onclick={() => app.set({ breakdownOpen: false, highlight: null, rows: null })}>
			Hide query breakdown
		</button>
	</header>

	<ul class="legend" aria-label="Colour legend: time relative to {baseline?.label ?? 'the baseline'}">
		{#each BAND_LEGEND as b (b.band)}
			<li data-band={b.band}>{b.label} <small>{b.range}</small></li>
		{/each}
		<li data-band="failed">Failed</li>
	</ul>

	{#if rowsFilter}
		<p class="filterchip">
			<button type="button" class="btn small" onclick={() => app.set({ rows: null })}>
				{rowsFilter.kind === 'fails' ? 'Showing failures of' : 'Showing queries won by'}
				{rowsFilter.series}
				<Icon name="close" size={14} />
				<span class="sr-only">Remove filter</span>
			</button>
		</p>
	{/if}

	{#if columns.length === 0}
		<p class="none">No solutions to show.</p>
	{:else}
		<div class="scroller" role="region" aria-label="Query breakdown table">
			<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
			<table bind:this={table} role="grid" aria-label="Time per query and solution" onkeydown={onGridKey}>
				<thead>
					<tr>
						<th class="first" scope="col">
							<label class="all">
								<input
									bind:this={headBox}
									type="checkbox"
									checked={allTicked}
									onchange={() => setTicked(rows.map((q) => q.idx), !allTicked)}
									aria-label="Include all listed queries"
								/>
								Query
							</label>
						</th>
						{#each columns as s (s.id)}
							<th
								scope="col"
								class:hl={app.hovered === s.id}
								class:pick={app.view.highlight === s.id}
								onpointerenter={() => (app.hovered = s.id)}
								onpointerleave={() => (app.hovered = null)}
							>
								<span class="colhead">
									<Swatch style={s.style} />
									<span>{s.id}</span>
								</span>
								{#if s.id === baseline?.id}<span class="badge">baseline</span>{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each rows as q, ri (q.idx)}
						<tr class:off={unticked.has(q.idx)}>
							<th class="first" scope="row">
								<div class="qlabel">
									<input
										type="checkbox"
										checked={!unticked.has(q.idx)}
										onchange={() => setTicked([q.idx], unticked.has(q.idx))}
										aria-label="Include Q{q.idx} in the comparison"
									/>
									<button type="button" class="qtext" use:tip={queryTip(q)}>
										<strong>Q{q.idx}</strong>
										{q.description}
									</button>
								</div>
							</th>
							{#each columns as s, ci (s.id)}
								{@const info = cellInfo(ci, q)}
								{@const key = `${q.idx}|${s.id}`}
								<td
									data-cell
									data-r={ri}
									data-c={ci}
									data-band={info.band}
									class:hl={app.hovered === s.id}
									class:pick={app.view.highlight === s.id}
									class:active={active === key}
									aria-label={info.label}
									tabindex={cur.r === ri && cur.c === ci ? 0 : -1}
									aria-describedby={active === key ? 'qtip-live' : undefined}
									onpointerenter={(e) => {
										app.hovered = s.id;
										if (e.pointerType !== 'touch') show(key, e.currentTarget);
									}}
									onpointerleave={(e) => {
										app.hovered = null;
										if (e.pointerType !== 'touch') hideSoon();
									}}
									onpointerdown={(e) => {
										if (e.pointerType === 'touch') {
											if (active === key) active = null;
											else show(key, e.currentTarget);
										}
									}}
									onfocusin={(e) => {
										cur = { r: ri, c: ci };
										show(key, e.currentTarget);
									}}
									onfocusout={(e) => onFocusOut(e, e.currentTarget)}
								>
									{#if info.time === null}
										<span class="fail"><span aria-hidden="true">✕</span> {info.reason}</span>
									{:else}
										<span class="time">{formatTime(info.time)}</span>
										{#if info.ratio !== null}<span class="ratio">{formatRatioCompact(info.ratio)}</span>{/if}
									{/if}
									{#if active === key && activeEl}
										<span id="qtip-live" class="sr-only">Query text shown</span>
										<QueryTextTip
											anchor={activeEl}
											text={ds.solutions[s.id]?.query_text[String(q.idx)]}
											language={ds.solutions[s.id]?.language ?? null}
											title="Q{q.idx} · {s.id}"
											onenter={() => clearTimeout(hideTimer)}
											onleave={hideSoon}
										/>
									{/if}
								</td>
							{/each}
						</tr>
					{:else}
						<tr><td colspan={columns.length + 1} class="empty">No queries to show.</td></tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.breakdown {
		position: relative;
		margin-top: 24px;
		padding: 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		flex-wrap: wrap;
	}
	h2 {
		font-size: 1.25rem;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 12px 0;
		padding: 0;
		list-style: none;
		font-size: 0.8125rem;
	}
	.legend li {
		padding: 2px 10px;
		border-radius: var(--radius-s);
	}
	.legend small {
		opacity: 0.85;
		margin-left: 4px;
	}
	.filterchip {
		margin: 0 0 8px;
	}
	.small {
		min-height: 28px;
		font-size: 0.8125rem;
	}
	.scroller {
		overflow: auto;
		max-width: 100%;
		max-height: min(78vh, 900px);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-s);
	}
	table {
		border-collapse: separate;
		border-spacing: 0;
		min-width: 100%;
		font-size: 0.8125rem;
	}
	th,
	td {
		padding: 4px 8px;
		border-bottom: 1px solid var(--border-subtle);
		vertical-align: middle;
	}
	thead th {
		position: sticky;
		top: 0;
		z-index: 3;
		background: var(--surface-subtle);
		color: var(--heading);
		font-weight: 600;
		text-align: left;
		min-width: 120px;
		vertical-align: bottom;
	}
	.first {
		position: sticky;
		left: 0;
		z-index: 2;
		width: 300px;
		min-width: 220px;
		max-width: 300px;
		background: var(--surface);
		text-align: left;
		font-weight: 400;
		border-right: 1px solid var(--border);
	}
	thead .first {
		z-index: 4;
		background: var(--surface-subtle);
	}
	.colhead {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.badge {
		display: inline-block;
		margin-top: 2px;
		padding: 0 6px;
		border-radius: 8px;
		background: var(--brand);
		color: var(--on-brand);
		font-size: 0.6875rem;
	}
	.qlabel,
	.all {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.qtext {
		display: block;
		padding: 0;
		border: 0;
		background: none;
		font: inherit;
		text-align: left;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
	}
	.qtext strong {
		color: var(--heading);
		margin-right: 4px;
	}
	tr.off > * {
		opacity: 0.45;
	}
	td {
		position: relative;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
		cursor: default;
	}
	.time {
		font-weight: 600;
	}
	.ratio {
		margin-left: 6px;
	}
	.fail {
		font-style: italic;
	}
	/* No filter or transform here: they would turn the cell into the containing block of its fixed-position tooltip. */
	td.hl,
	th.hl {
		background-image: linear-gradient(var(--overlay), var(--overlay));
	}
	th.pick,
	td.pick {
		border-inline: 2px solid var(--focus);
	}
	td:focus-visible {
		outline: 2px solid var(--focus);
		outline-offset: -2px;
	}
	.empty {
		padding: 24px;
		text-align: center;
		color: var(--text-secondary);
	}
	.none {
		color: var(--text-secondary);
	}
</style>
