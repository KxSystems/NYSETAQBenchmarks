<script lang="ts">
	import { capitalise } from '../../model/format';
	import { FAIL_LABEL, type FailReason } from '../../model/calc';
	import { useApp } from '../../state/app.svelte';
	import ChartFrame from './ChartFrame.svelte';
	import { withSeriesTip } from '../../model/describe';
	import VBarChart, { type VBar } from './VBarChart.svelte';

	const app = useApp();
	const r = $derived(app.resolved!);
	const a = $derived(app.analysis!);

	const REASONS: FailReason[] = ['error', 'notrun', 'notimpl'];
	const FILL: Record<FailReason, string> = {
		error: 'var(--fail-error)',
		notrun: 'var(--fail-notrun)',
		notimpl: 'var(--fail-notimpl)'
	};

	const bars = $derived<VBar[]>(
		a.ordered.map((s) => {
			const f = a.failures.get(s.id)!;
			const parts = REASONS.map((k) => `${f[k]} ${FAIL_LABEL[k]}`).join(', ');
			return {
				id: s.id,
				label: s.label,
				style: s.style,
				segments: REASONS.map((k) => ({ key: k, value: f[k], fill: FILL[k], stroke: 'var(--text-secondary)' })),
				text: String(f.total),
				ariaLabel: `${s.label}: ${f.total} failed queries (${parts}).${f.total ? ' Open query breakdown with these queries.' : ''}`,
				tip: withSeriesTip(
					{ title: s.label, lines: [`${f.total} failed of ${r.comparedQueries.length} compared queries`, ...REASONS.map((k) => `${FAIL_LABEL[k]}: ${f[k]}`)] },
					s.tip
				),
				onclick: f.total ? () => app.openBreakdown(s.id, { kind: 'fails', series: s.id }) : undefined
			};
		})
	);
	const max = $derived(Math.max(1, ...bars.map((b) => Number(b.text))));
	const step = $derived(Math.max(1, Math.ceil(max / 5)));
	const ticks = $derived(Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step));
</script>

<ChartFrame id="failures" title="Query failures" subtitle="Compared queries without a result for the selected timing">
	<ul class="legend" aria-label="Failure reasons">
		{#each REASONS as k (k)}
			<li><span class="key" style:background={FILL[k]}></span>{FAIL_LABEL[k]}</li>
		{/each}
	</ul>
	{#if bars.length}
		<VBarChart {bars} yMax={Math.ceil(max * 1.12)} yTicks={ticks} />
	{:else}
		<p class="none">No results to show.</p>
	{/if}
	{#snippet alt()}
		<table>
			<caption>Failed compared queries per {app.logic.seriesNoun[0]}</caption>
			<thead><tr><th>{capitalise(app.logic.seriesNoun[0])}</th><th>Total</th><th>Error</th><th>Not run</th><th>Not implemented</th></tr></thead>
			<tbody>
				{#each a.ordered as s (s.id)}
					{@const f = a.failures.get(s.id)!}
					<tr><td>{s.label}</td><td>{f.total}</td><td>{f.error}</td><td>{f.notrun}</td><td>{f.notimpl}</td></tr>
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
		width: 12px;
		height: 12px;
		border: 1px solid var(--border);
		border-radius: 2px;
	}
	.none {
		color: var(--text-secondary);
	}
</style>
