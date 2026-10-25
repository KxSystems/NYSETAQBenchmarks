<script lang="ts">
	import { capitalise } from '../../model/format';
	import * as Plot from '@observablehq/plot';
	import { seriesColor, seriesFill } from '../../model/colours';
	import { withSeriesTip } from '../../model/describe';
	import { formatRatio } from '../../model/format';
	import { linearScalingScore } from '../../model/threads';
	import { useApp } from '../../state/app.svelte';
	import { tip } from '../../state/tooltip.svelte';
	import Icon from '../ui/Icon.svelte';
	import Swatch from '../ui/Swatch.svelte';
	import BaselineSelect from './BaselineSelect.svelte';
	import ChartFrame from './ChartFrame.svelte';
	import PlotView from './PlotView.svelte';
	import ScaleToggle from './ScaleToggle.svelte';

	const app = useApp();
	const r = $derived(app.resolved!);
	const a = $derived(app.analysis!);

	const STEP = 44;
	const MT = 8;
	const MB = 34;
	const MR = 116;
	const MR_NARROW = 84;

	interface Row {
		id: string;
		label: string;
		kind: 'scored' | 'unscored' | 'failed';
		score: number | null;
		used: number;
		penalised: number;
		exitCode?: number;
		style: (typeof r.compared)[number]['style'];
	}

	const rows = $derived<Row[]>([
		...a.ordered.map((s): Row => {
			const sc = a.scores.get(s.id)!;
			return {
				id: s.id,
				label: s.label,
				kind: sc.score === null ? 'unscored' : 'scored',
				score: sc.score,
				used: sc.used,
				penalised: sc.penalised,
				style: s.style
			};
		}),
		...r.failed.map(
			(f): Row => ({ id: f.id, label: f.label, kind: 'failed', score: null, used: 0, penalised: 0, exitCode: f.exitCode, style: f.style })
		)
	]);

	const scored = $derived(rows.filter((x) => x.kind === 'scored'));
	const log = $derived(app.view.scale === 'log');
	const scoreValues = $derived(scored.map((x) => x.score!));

	// Thread scaling, log scale: the score each series would have with ideal linear scaling.
	const tipById = $derived(new Map([...r.compared, ...r.failed].map((s) => [s.id, s.tip])));
	const scaling = $derived.by(() => {
		const base = r.baseline?.sortKey;
		if (app.logic.id !== 'threads' || !log || !base) return [];
		return r.compared
			.filter((s) => s.sortKey && scored.some((x) => x.id === s.id))
			.map((s) => ({ id: s.id, ideal: linearScalingScore(base, s.sortKey!) }));
	});
	const idealValues = $derived(scaling.map((x) => x.ideal));
	const xMin = $derived(
		log ? 10 ** Math.floor(Math.log10(Math.min(1, ...scoreValues, ...idealValues))) : 0
	);
	const xMax = $derived(
		log ? 10 ** Math.ceil(Math.log10(Math.max(1, ...scoreValues))) : Math.max(1, ...scoreValues) * 1.02
	);
	const height = $derived(MT + rows.length * STEP + MB);

	function build(width: number) {
		const narrow = width < 420;
		const ticks = log
			? Array.from({ length: Math.round(Math.log10(xMax / xMin)) + 1 }, (_, i) => xMin * 10 ** i)
			: undefined;
		const bar = { y: 'id', insetTop: 8, insetBottom: 8 } as const;
		const failed = rows.filter((x) => x.kind === 'failed');
		return Plot.plot({
			width,
			height,
			marginTop: MT,
			marginBottom: MB,
			marginLeft: 6,
			marginRight: narrow ? MR_NARROW : MR,
			style: { background: 'transparent', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '12px', overflow: 'visible' },
			x: {
				type: log ? 'log' : 'linear',
				domain: [xMin, xMax],
				axis: 'bottom',
				grid: true,
				label: null,
				ticks,
				tickFormat: (d: number) => `×${+d.toPrecision(3)}`
			},
			y: { domain: rows.map((x) => x.id), axis: null, padding: 0 },
			marks: [
				Plot.barX(scored, {
					...bar,
					x1: xMin,
					x2: 'score',
					fill: (d: Row) => seriesFill(d.style),
					stroke: (d: Row) => seriesColor(d.style),
					strokeWidth: 1.5
				}),
				Plot.barX(failed, { ...bar, x1: xMin, x2: xMax, fill: 'var(--failed-bar)', stroke: 'var(--text-secondary)', strokeWidth: 0.75 }),
				Plot.ruleX([1], { stroke: 'var(--heading)', strokeDasharray: '4 3', strokeWidth: 1.5 }),
				Plot.line(scaling, { x: 'ideal', y: 'id', stroke: 'var(--heading)', strokeDasharray: '7 4', strokeWidth: 1.5 }),
				Plot.dot(scaling, { x: 'ideal', y: 'id', r: 3, fill: 'var(--surface-subtle)', stroke: 'var(--heading)' }),
				Plot.text(scaling.slice(-1), {
					x: 'ideal',
					y: 'id',
					text: () => 'linear scaling',
					dx: 10,
					dy: -15,
					textAnchor: 'start',
					fill: 'var(--heading)',
					stroke: 'var(--surface-subtle)',
					strokeWidth: 3,
					paintOrder: 'stroke',
					fontStyle: 'italic'
				}),
				Plot.text(scored, {
					y: 'id',
					x: 'score',
					text: (d: Row) => formatRatio(d.score!),
					dx: 6,
					textAnchor: 'start',
					lineWidth: narrow ? 6 : 100,
					fill: 'var(--text)',
					fontWeight: 600
				}),
				Plot.text(failed, {
					y: 'id',
					x: xMin,
					text: (d: Row) => `Failed — exit ${d.exitCode}`,
					dx: 8,
					textAnchor: 'start',
					fill: 'var(--text)',
					fontWeight: 600
				})
			]
		});
	}

	const baselineId = $derived(r.baseline?.id ?? null);

	function tipFor(row: Row) {
		return withSeriesTip(baseTip(row), tipById.get(row.id));
	}

	function baseTip(row: Row) {
		if (row.kind === 'failed') {
			return {
				title: row.label,
				lines: [
					`The run failed before running any query (exit code ${row.exitCode}).`,
					row.exitCode === 137 ? '137: killed by the operating system, usually out of memory.' : ''
				].filter(Boolean)
			};
		}
		if (row.score === null) return { title: row.label, lines: ['No compared query has a baseline time.'] };
		return {
			title: row.label,
			lines: [
				`Score ${formatRatio(row.score)} (${row.score.toFixed(3)})`,
				`${row.used} compared queries used, ${row.penalised} counted with the penalty`
			]
		};
	}

	function label(row: Row) {
		if (row.kind === 'failed') return `${row.label}: failed, exit code ${row.exitCode}`;
		if (row.score === null) return `${row.label}: no score`;
		return `${row.label}: ${formatRatio(row.score)} relative to ${r.baseline?.label}, ${row.used} queries, ${row.penalised} with penalty. Open query breakdown.`;
	}
</script>

<ChartFrame id="geomean">
	{#snippet heading()}
		Geometric mean of per-query time ratios, relative to <BaselineSelect />
	{/snippet}
	{#snippet controls()}<ScaleToggle />{/snippet}
	{#snippet subtitle()}
		Lower is better. Failed queries count with a penalty <a href="#note-1" aria-label="note 1">[1]</a>.
		{#if log}Log scale.{/if}
		{#if scaling.length}The dashed line shows ideal linear scaling from the baseline.{/if}
	{/snippet}

	{#if rows.length === 0}
		<p class="none">No results to show.</p>
	{:else}
		<div class="grid" style:--step="{STEP}px" style:--mt="{MT}px">
			<ol class="labels" style:padding-top="{MT}px">
				{#each rows as row (row.id)}
					<li class="label" class:hl={app.hovered === row.id} class:failed={row.kind === 'failed'}>
						<Swatch style={row.style} />
						<span class="namecell">
							<span class="name" use:tip={tipById.get(row.id)}>{row.label}</span>
							{#if row.id === baselineId}<span class="badge">baseline</span>{/if}
						</span>
						<button
							type="button"
							class="remove"
							aria-label="Remove {row.label}"
							onclick={() => app.removeSeries(row.id)}
						>
							<Icon name="close" size={14} />
						</button>
					</li>
				{/each}
			</ol>
			<div class="plotcell">
				<PlotView {build} />
				<div class="hits" style:top="{MT}px">
					{#each rows as row (row.id)}
						{#if row.kind === 'failed' || row.kind === 'unscored'}
							<button
								type="button"
								class="hit info"
								class:hl={app.hovered === row.id}
								aria-label={label(row)}
								use:tip={tipFor(row)}
								onpointerenter={() => (app.hovered = row.id)}
								onpointerleave={() => (app.hovered = null)}
								onfocus={() => (app.hovered = row.id)}
								onblur={() => (app.hovered = null)}
							></button>
						{:else}
							<button
								type="button"
								class="hit"
								class:hl={app.hovered === row.id}
								aria-label={label(row)}
								use:tip={tipFor(row)}
								onclick={() => app.openBreakdown(row.id)}
								onpointerenter={() => (app.hovered = row.id)}
								onpointerleave={() => (app.hovered = null)}
								onfocus={() => (app.hovered = row.id)}
								onblur={() => (app.hovered = null)}
							></button>
						{/if}
					{/each}
				</div>
			</div>
		</div>
	{/if}

	{#snippet alt()}
		<table>
			<caption>Geometric mean of time ratios relative to {r.baseline?.label}</caption>
			<thead><tr><th>{capitalise(app.logic.seriesNoun[0])}</th><th>Score</th><th>Queries used</th><th>With penalty</th></tr></thead>
			<tbody>
				{#each rows as row (row.id)}
					<tr>
						<td>{row.label}</td>
						<td>{row.kind === 'failed' ? `Failed, exit ${row.exitCode}` : row.score === null ? 'no score' : formatRatio(row.score)}</td>
						<td>{row.used}</td>
						<td>{row.penalised}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/snippet}
</ChartFrame>

<style>
	.grid {
		display: grid;
		grid-template-columns: var(--lw, clamp(116px, 26vw, 260px)) minmax(0, 1fr);
		align-items: start;
	}
	.labels {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.label {
		display: flex;
		align-items: center;
		gap: 6px;
		height: var(--step);
		padding-right: 4px;
		font-size: 0.8125rem;
		line-height: 1.2;
		color: var(--heading);
		border-radius: var(--radius-s) 0 0 var(--radius-s);
	}
	.label.hl {
		background: var(--brand-weak);
	}
	.label.failed .name {
		color: var(--text-disabled);
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
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.badge {
		flex: none;
		padding: 0 6px;
		border-radius: 8px;
		background: var(--brand);
		color: var(--on-brand);
		font-size: 0.6875rem;
		font-weight: 600;
	}
	.remove {
		flex: none;
		display: grid;
		place-items: center;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--text-secondary);
	}
	.remove:hover {
		background: var(--hover-fill);
		color: var(--on-brand);
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
		cursor: pointer;
	}
	.hit.info {
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
