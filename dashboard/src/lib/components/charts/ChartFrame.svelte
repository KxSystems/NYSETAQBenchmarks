<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		id,
		title,
		heading,
		subtitle,
		controls,
		alt,
		children
	}: {
		id: string;
		title?: string;
		/** Replaces `title` when the heading contains controls (e.g. the baseline dropdown). */
		heading?: Snippet;
		subtitle?: Snippet | string;
		controls?: Snippet;
		/** Visually hidden text alternative, usually a table. */
		alt?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="chart" aria-labelledby="{id}-title">
	<header>
		<h3 id="{id}-title">{#if heading}{@render heading()}{:else}{title}{/if}</h3>
		{#if controls}<div class="controls">{@render controls()}</div>{/if}
	</header>
	<p class="subtitle">
		{#if typeof subtitle === 'string'}{subtitle}{:else if subtitle}{@render subtitle()}{/if}
	</p>
	{@render children()}
	{#if alt}<div class="sr-only">{@render alt()}</div>{/if}
</section>

<style>
	.chart {
		position: relative;
		min-width: 0;
		padding: 16px;
		background: var(--surface-subtle);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-m);
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px 16px;
	}
	h3 {
		font-size: 1.0625rem;
		flex: 1 1 280px;
		min-width: 0;
	}
	.subtitle {
		margin: 4px 0 12px;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}
</style>
