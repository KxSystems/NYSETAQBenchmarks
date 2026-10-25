<script lang="ts">
	import { seriesColor, seriesFill } from '../../model/colours';
	import { useApp } from '../../state/app.svelte';
	import { tip } from '../../state/tooltip.svelte';
	import ChartFrame from './ChartFrame.svelte';
	import Swatch from '../ui/Swatch.svelte';

	const app = useApp();
	const r = $derived(app.resolved!);
	const a = $derived(app.analysis!);

	const slices = $derived(
		a.ordered
			.map((s) => ({ s, n: a.wins.get(s.id) ?? 0 }))
			.filter((x) => x.n > 0)
			.sort((x, y) => y.n - x.n || x.s.id.localeCompare(y.s.id))
	);
	const sum = $derived(slices.reduce((t, x) => t + x.n, 0));
	const queryCount = $derived(r.comparedQueries.length);

	const C = 100;
	const R = 92;
	function arcPath(from: number, to: number): string {
		if (to - from >= 2 * Math.PI - 1e-9) {
			return `M ${C - R} ${C} a ${R} ${R} 0 1 0 ${2 * R} 0 a ${R} ${R} 0 1 0 ${-2 * R} 0 Z`;
		}
		const p = (t: number) => [C + R * Math.sin(t), C - R * Math.cos(t)] as const;
		const [x0, y0] = p(from);
		const [x1, y1] = p(to);
		return `M ${C} ${C} L ${x0} ${y0} A ${R} ${R} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x1} ${y1} Z`;
	}
	const paths = $derived.by(() => {
		let acc = 0;
		return slices.map((x) => {
			const from = (acc / sum) * 2 * Math.PI;
			acc += x.n;
			return { ...x, d: arcPath(from, (acc / sum) * 2 * Math.PI) };
		});
	});

	const share = (n: number) => `${((n / Math.max(1, queryCount)) * 100).toFixed(0)}%`;
	const tipFor = (id: string, n: number) => ({
		title: id,
		lines: [`${n} wins, ${share(n)} of ${queryCount} compared queries`]
	});
</script>

<ChartFrame
	id="wins"
	title="Wins per solution"
	subtitle="Number of compared queries on which the solution posts the fastest time"
>
	{#if slices.length === 0}
		<p class="none">No compared query has a time for any solution.</p>
	{:else}
		<div class="pie">
			<svg viewBox="0 0 200 200" role="group" aria-label="Pie chart of wins per solution">
				{#each paths as p (p.s.id)}
					<path
						d={p.d}
						fill={seriesFill(p.s.style)}
						stroke={p.s.style.tier ? seriesColor(p.s.style) : 'var(--surface)'}
						stroke-width="1.5"
						class:hl={app.hovered === p.s.id}
						tabindex="0"
						role="button"
						aria-label="{p.s.id}: {p.n} wins, {share(p.n)} of compared queries. Open query breakdown with these queries."
						use:tip={tipFor(p.s.id, p.n)}
						onclick={() => app.openBreakdown(p.s.id, { kind: 'wins', series: p.s.id })}
						onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), app.openBreakdown(p.s.id, { kind: 'wins', series: p.s.id }))}
						onpointerenter={() => (app.hovered = p.s.id)}
						onpointerleave={() => (app.hovered = null)}
						onfocus={() => (app.hovered = p.s.id)}
						onblur={() => (app.hovered = null)}
					/>
				{/each}
			</svg>
			<ul class="legend">
				{#each slices as x (x.s.id)}
					<li class:hl={app.hovered === x.s.id}>
						<Swatch style={x.s.style} />
						<span class="n">{x.s.id}</span>
						<span class="c">{x.n}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
	{#snippet alt()}
		<table>
			<caption>Wins per solution</caption>
			<thead><tr><th>Solution</th><th>Wins</th></tr></thead>
			<tbody>
				{#each a.ordered as s (s.id)}
					<tr><td>{s.id}</td><td>{a.wins.get(s.id) ?? 0}</td></tr>
				{/each}
			</tbody>
		</table>
	{/snippet}
</ChartFrame>

<style>
	.pie {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 16px 24px;
	}
	svg {
		flex: 0 1 240px;
		width: 240px;
		max-width: 100%;
		height: auto;
		overflow: visible;
	}
	path {
		cursor: pointer;
	}
	path:hover,
	path.hl {
		filter: brightness(1.12);
		stroke: var(--heading);
	}
	.legend {
		flex: 1 1 180px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 0.875rem;
	}
	.legend li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 6px;
		border-radius: var(--radius-s);
	}
	.legend li.hl {
		background: var(--brand-weak);
	}
	.n {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.c {
		font-weight: 600;
		color: var(--heading);
		font-variant-numeric: tabular-nums;
	}
	.none {
		color: var(--text-secondary);
	}
</style>
