<script lang="ts">
	import { useApp } from '../../state/app.svelte';

	const app = useApp();
	const r = $derived(app.resolved!);
</script>

<select
	class="baseline"
	aria-label="Baseline {app.logic.seriesNoun[0]}"
	value={r.baselineChoice}
	onchange={(e) => app.set({ baseline: e.currentTarget.value })}
>
	{#each r.baselineOptions as o (o.id)}
		<option value={o.id} class:dim={!o.hasResults}>
			{o.label}{o.hasResults ? '' : ' (no results)'}
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
