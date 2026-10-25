<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, children, actions }: { title: string; children?: Snippet; actions?: Snippet } = $props();
</script>

<div class="msg" role="alert">
	<h2>{title}</h2>
	{#if children}<p>{@render children()}</p>{/if}
	{#if actions}<div class="actions">{@render actions()}</div>{/if}
</div>

<style>
	.msg {
		margin: 24px 0;
		padding: 24px;
		border: 1px dashed var(--border);
		border-radius: var(--radius-m);
		background: var(--surface);
		text-align: center;
	}
	h2 {
		font-size: 1.125rem;
	}
	p {
		margin: 8px 0 0;
		color: var(--text-secondary);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 16px;
	}
</style>
