<script lang="ts">
	import { capitalise } from '../../model/format';
	import { seriesColor, seriesFill } from '../../model/colours';
	import { formatGB } from '../../model/format';
	import type { MemoryBar } from '../../model/loadtime';
	import { useApp } from '../../state/app.svelte';
	import { withSeriesTip } from '../../model/describe';
	import ChartFrame from './ChartFrame.svelte';
	import VBarChart, { type VBar } from './VBarChart.svelte';

	let {
		id,
		title,
		subtitle,
		data,
		noun
	}: { id: string; title: string; subtitle: string; data: MemoryBar[]; noun: string } = $props();

	const app = useApp();
	const styles = $derived(app.resolved!.styles);
	const seriesById = $derived(new Map(app.resolved!.compared.map((s) => [s.id, s])));

	const bars = $derived<VBar[]>(
		data.map((d) => {
			const style = styles.get(d.id)!;
			return {
				id: d.id,
				label: app.label(d.id),
				style,
				segments: d.gb === null ? [] : [{ key: 'gb', value: d.gb, fill: seriesFill(style), stroke: seriesColor(style) }],
				text: d.gb === null ? 'n/a' : formatGB(d.gb),
				ariaLabel: `${app.label(d.id)}: ${d.gb === null ? 'not available' : `${formatGB(d.gb)} GB`}`,
				tip: withSeriesTip(
					{ title: app.label(d.id), lines: [d.gb === null ? `${noun}: not available` : `${noun}: ${formatGB(d.gb)} GB`] },
					seriesById.get(d.id)?.tip
				)
			};
		})
	);
	const max = $derived(Math.max(1, ...data.map((d) => d.gb ?? 0)));
</script>

<ChartFrame {id} {title} {subtitle}>
	{#if bars.length}
		<VBarChart {bars} yMax={max * 1.12} yFormat={(d) => String(+d.toPrecision(3))} />
	{:else}
		<p class="none">No results to show.</p>
	{/if}
	{#snippet alt()}
		<table>
			<caption>{title}</caption>
			<thead><tr><th>{capitalise(app.logic.seriesNoun[0])}</th><th>GB</th></tr></thead>
			<tbody>
				{#each data as d (d.id)}
					<tr><td>{app.label(d.id)}</td><td>{d.gb === null ? 'n/a' : formatGB(d.gb)}</td></tr>
				{/each}
			</tbody>
		</table>
	{/snippet}
</ChartFrame>

<style>
	.none {
		color: var(--text-secondary);
	}
</style>
