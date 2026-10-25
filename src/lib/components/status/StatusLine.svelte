<script lang="ts">
	import { TIMING_LABEL } from '../../data/types';
	import { threadsLabel } from '../../model/format';
	import { useApp } from '../../state/app.svelte';

	const app = useApp();
	const r = $derived(app.resolved!);
	const total = $derived(app.ds!.queries.length);
	const load = $derived(app.view.tab === 'load');

	const text = $derived.by(() => {
		const n = r.compared.length;
		const parts = [
			`Comparing ${n} ${n === 1 ? 'solution' : 'solutions'}${r.failed.length ? ` (+${r.failed.length} failed)` : ''}${load ? '' : ` on ${r.comparedQueries.length} of ${total} queries`}`,
			r.setup.machine ?? 'no machine',
			app.view.size,
			r.setup.date ?? 'no date',
			threadsLabel(r.setup.threads),
			load ? 'load times' : TIMING_LABEL[app.view.timing].toLowerCase(),
			r.baseline ? `baseline ${r.baseline.label}` : 'no baseline'
		];
		return parts.join(' · ');
	});
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
