<script lang="ts">
	import { useApp } from '../../state/app.svelte';

	const app = useApp();
</script>

<div class="scale" role="group" aria-label="Scale">
	{#each ['linear', 'log'] as s (s)}
		<button
			type="button"
			class:on={app.view.scale === s}
			aria-pressed={app.view.scale === s}
			onclick={() => app.set({ scale: s as 'linear' | 'log' })}
		>
			{s === 'linear' ? 'Linear' : 'Log'}
		</button>
	{/each}
</div>

<style>
	.scale {
		display: inline-flex;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		overflow: hidden;
	}
	button {
		min-height: 32px;
		padding: 0 12px;
		border: 0;
		background: var(--surface);
		font-size: 0.875rem;
	}
	button + button {
		border-left: 1px solid var(--border);
	}
	button:hover {
		background: var(--hover-fill);
		color: var(--on-brand);
	}
	button.on {
		background: var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}
</style>
