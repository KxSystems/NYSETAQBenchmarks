<script lang="ts">
	import { useApp } from '../../state/app.svelte';

	const app = useApp();
	const r = $derived(app.resolved!);
	const text = $derived(app.logic.statusText(app.ds!, app.view, r));
</script>

<div class="status" role="status" aria-live="polite" aria-label="Comparison summary">
	<p class="main">{text}</p>
	{#each r.notices as n (n)}<p class="notice">{n}</p>{/each}
	{#if r.setup.numa.length === 0}
		<p class="notice">No NUMA node is selected.</p>
	{/if}
</div>

<style>
	.status {
		margin: 12px 0;
		font-size: 0.875rem;
	}
	p {
		margin: 0;
	}
	.main {
		color: var(--text-secondary);
	}
	.notice {
		margin-top: 4px;
		padding: 4px 10px;
		border-left: 3px solid var(--link);
		background: var(--brand-weak);
		color: var(--text);
	}
</style>
