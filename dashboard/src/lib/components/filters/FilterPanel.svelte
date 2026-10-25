<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from '../ui/Icon.svelte';

	let {
		id,
		title,
		onclose,
		children
	}: { id: string; title: string; onclose: () => void; children: Snippet } = $props();
</script>

<section class="panel fade-in" {id} aria-label="{title} filters">
	<header>
		<h2>{title}</h2>
		<button type="button" class="close" onclick={onclose} aria-label="Close {title} filters">
			<Icon name="close" size={18} />
		</button>
	</header>
	<div class="body">{@render children()}</div>
</section>

<style>
	.panel {
		pointer-events: auto;
		flex: 1 1 300px;
		max-width: 440px;
		max-height: calc(100vh - 160px);
		overflow: auto;
		padding: 12px 16px 16px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		box-shadow: var(--shadow);
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}
	h2 {
		font-size: 1rem;
	}
	.close {
		display: grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: 0;
		border-radius: var(--radius-s);
		background: none;
	}
	.close:hover {
		background: var(--hover-fill);
		color: var(--on-brand);
	}
	@media (max-width: 639.98px) {
		/* Bottom sheet on phones. */
		.panel {
			position: fixed;
			inset: auto 0 0 0;
			max-width: none;
			max-height: 70vh;
			border-radius: var(--radius-m) var(--radius-m) 0 0;
			z-index: 50;
		}
	}
</style>
