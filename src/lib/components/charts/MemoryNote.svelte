<script lang="ts">
	import { memoryNote } from '../../model/threads';
	import { useApp } from '../../state/app.svelte';

	const app = useApp();
	const note = $derived(memoryNote(app.resolved!.compared));
</script>

<section class="memory-note" aria-labelledby="memory-note-title">
	<h3 id="memory-note-title">Memory</h3>
	<p>{note ?? 'No memory values are available for the compared runs.'}</p>
	<p class="why">Peak memory and data size are measured once per run, not per thread count.</p>
</section>

<style>
	.memory-note {
		padding: 16px;
		background: var(--surface-subtle);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-m);
	}
	h3 {
		font-size: 1.0625rem;
	}
	p {
		margin: 8px 0 0;
	}
	.why {
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
</style>
