<script lang="ts">
	import * as Plot from '@observablehq/plot';
	import { withSeriesTip } from '../../model/describe';
	import { capitalise, formatRatio } from '../../model/format';
	import { loadRows, phaseLabel, phasesPresent } from '../../model/loadtime';
	import { useApp } from '../../state/app.svelte';
	import { tip } from '../../state/tooltip.svelte';
	import Swatch from '../ui/Swatch.svelte';
	import BaselineSelect from './BaselineSelect.svelte';
	import ChartFrame from './ChartFrame.svelte';
	import PlotView from './PlotView.svelte';

	const app = useApp();
	const r = $derived(app.resolved!);
	const ds = $derived(app.ds!);

	const STEP = 44;
	const MT = 8;
	const MB = 34;
	const MR = 190;
	const MR_NARROW = 84;

	const rows = $derived(loadRows(r.compared, r.baseline, r.ordering));
	const phases = $derived(phasesPresent(ds.load_phases, r.compared));
	const seriesById = $derived(new Map(r.compared.map((s) => [s.id, s])));
	const height = $derived(MT + rows.length * STEP + MB);
	const xMax = $derived(Math.max(1, ...rows.map((x) => x.total)) / 1e9);

	const phaseFill = (p: string) => `var(--phase-${['load', 'transform', 'sort', 'index'].includes(p) ? p : 'sort'})`;
	const seconds = (ns: number) => `${(ns / 1e9).toFixed(ns < 1e8 ? 2 : 1)}s`;
	const endLabel = (x: (typeof rows)[number]) =>
		x.ratio === null ? seconds(x.total) : `${seconds(x.total)} · ${formatRatio(x.ratio)}`;

	function build(width: number) {
		const narrow = width < 520;
		const segs = rows.flatMap((x) => {
			let acc = 0;
			return phases
				.filter((p) => p in x.phases && x.phases[p]! > 0)
				.map((p) => ({ id: x.id, phase: p, x1: acc / 1e9, x2: (acc += x.phases[p]!) / 1e9 }));
		});
		return Plot.plot({
			width,
			height,
			marginTop: MT,
			marginBottom: MB,
			marginLeft: 6,
			marginRight: narrow ? MR_NARROW : MR,
			style: { background: 'transparent', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '12px', overflow: 'visible' },
			x: { domain: [0, xMax], axis: 'bottom', grid: true, label: null, tickFormat: (d: number) => `${d}s` },
			y: { domain: rows.map((x) => x.id), axis: null, padding: 0 },
			marks: [
				Plot.barX(segs, {
					y: 'id',
					x1: 'x1',
					x2: 'x2',
					fill: (d: { phase: string }) => phaseFill(d.phase),
					stroke: 'var(--text-secondary)',
					strokeWidth: 0.75,
					insetTop: 8,
					insetBottom: 8
				}),
				Plot.text(rows, {
					y: 'id',
					x: (d: (typeof rows)[number]) => d.total / 1e9,
					text: endLabel,
					dx: 6,
					textAnchor: 'start',
					lineWidth: narrow ? 6 : 100,
					fill: 'var(--text)',
					fontWeight: 600
				})
			]
		});
	}

	function tipFor(x: (typeof rows)[number]) {
		return withSeriesTip({
			title: app.label(x.id),
			lines: [
				`Total ${seconds(x.total)}${x.ratio === null ? '' : ` (${formatRatio(x.ratio)} vs ${r.baseline?.label})`}`,
				...phases.filter((p) => p in x.phases).map((p) => `${phaseLabel(p)}: ${seconds(x.phases[p]!)}`)
			]
		}, seriesById.get(x.id)?.tip);
	}
</script>

<ChartFrame id="loadtime">
	{#snippet heading()}Total load time, relative to <BaselineSelect />{/snippet}
	{#snippet subtitle()}Time to get the data into memory and ready to query, split by phase.{/snippet}
	<ul class="legend" aria-label="Load phases">
		{#each phases as p (p)}
			<li><span class="key" style:background={phaseFill(p)}></span>{phaseLabel(p)}</li>
		{/each}
	</ul>
	{#if rows.length}
		<div class="grid" style:--step="{STEP}px">
			<ol class="labels" style:padding-top="{MT}px">
				{#each rows as x (x.id)}
					<li class:hl={app.hovered === x.id}>
						<Swatch style={seriesById.get(x.id)!.style} />
						<span class="namecell">
							<span class="name">{app.label(x.id)}</span>
							{#if x.id === r.baseline?.id}<span class="badge">baseline</span>{/if}
						</span>
					</li>
				{/each}
			</ol>
			<div class="plotcell">
				<PlotView {build} />
				<div class="hits" style:top="{MT}px">
					{#each rows as x (x.id)}
						<button
							type="button"
							class="hit"
							class:hl={app.hovered === x.id}
							aria-label="{app.label(x.id)}: total load time {seconds(x.total)}{x.ratio === null ? '' : `, ${formatRatio(x.ratio)} relative to ${r.baseline?.label}`}"
							use:tip={tipFor(x)}
							onpointerenter={() => (app.hovered = x.id)}
							onpointerleave={() => (app.hovered = null)}
							onfocus={() => (app.hovered = x.id)}
							onblur={() => (app.hovered = null)}
						></button>
					{/each}
				</div>
			</div>
		</div>
	{:else}
		<p class="none">No results to show.</p>
	{/if}
	{#snippet alt()}
		<table>
			<caption>Total load time per {app.logic.seriesNoun[0]}</caption>
			<thead><tr><th>{capitalise(app.logic.seriesNoun[0])}</th><th>Total</th>{#each phases as p (p)}<th>{phaseLabel(p)}</th>{/each}</tr></thead>
			<tbody>
				{#each rows as x (x.id)}
					<tr>
						<td>{app.label(x.id)}</td><td>{seconds(x.total)}</td>
						{#each phases as p (p)}<td>{p in x.phases ? seconds(x.phases[p]!) : '—'}</td>{/each}
					</tr>
				{/each}
			</tbody>
		</table>
	{/snippet}
</ChartFrame>

<style>
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 16px;
		margin: 0 0 8px;
		padding: 0;
		list-style: none;
		font-size: 0.8125rem;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.key {
		width: 14px;
		height: 14px;
		border: 1px solid var(--text-secondary);
		border-radius: 2px;
	}
	.grid {
		display: grid;
		grid-template-columns: clamp(116px, 26vw, 260px) minmax(0, 1fr);
		align-items: start;
	}
	.labels {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.labels li {
		display: flex;
		align-items: center;
		gap: 6px;
		height: var(--step);
		font-size: 0.8125rem;
		line-height: 1.2;
		color: var(--heading);
	}
	.labels li.hl {
		background: var(--brand-weak);
	}
	.namecell {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
	}
	/* Wide screens keep the badge beside the name, as before. */
	@media (min-width: 640px) {
		.namecell {
			flex-direction: row;
			align-items: center;
			gap: 6px;
		}
		.name {
			flex: 1;
		}
	}
	.name {
		max-width: 100%;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.badge {
		padding: 0 6px;
		border-radius: 8px;
		background: var(--brand);
		color: var(--on-brand);
		font-size: 0.6875rem;
		font-weight: 600;
	}
	.plotcell {
		position: relative;
		min-width: 0;
	}
	.hits {
		position: absolute;
		left: 0;
		right: 0;
	}
	.hit {
		display: block;
		width: 100%;
		height: var(--step);
		padding: 0;
		border: 0;
		background: transparent;
		cursor: default;
	}
	.hit.hl,
	.hit:hover {
		background: color-mix(in srgb, var(--brand) 30%, transparent);
	}
	.none {
		color: var(--text-secondary);
	}
</style>
