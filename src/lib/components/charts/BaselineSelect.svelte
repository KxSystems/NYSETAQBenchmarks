<script lang="ts">
	import { solutionOrder } from '../../model/colours';
	import { solutionsWithResults } from '../../model/series';
	import { useApp } from '../../state/app.svelte';

	const app = useApp();
	const ds = $derived(app.ds!);
	const r = $derived(app.resolved!);
	const names = $derived(solutionOrder(Object.keys(ds.solutions)));
	const withResults = $derived(solutionsWithResults(ds, r.setup));
</script>

<select
	class="baseline"
	aria-label="Baseline solution"
	value={r.baselineChoice}
	onchange={(e) => app.set({ baseline: e.currentTarget.value })}
>
	{#each names as n (n)}
		<option value={n} class:dim={!withResults.has(n)}>
			{n}{withResults.has(n) ? '' : ' (no results)'}
		</option>
	{/each}
</select>

<style>
	.baseline {
		font: inherit;
		font-weight: 600;
		color: var(--heading);
		max-width: 100%;
		text-overflow: ellipsis;
		min-height: 32px;
		padding: 2px 8px;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface);
	}
	.dim {
		color: var(--text-disabled);
	}
</style>
