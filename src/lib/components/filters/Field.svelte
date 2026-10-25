<script lang="ts">
	import type { Snippet } from 'svelte';
	import HelpTip from '../ui/HelpTip.svelte';

	let {
		label,
		help,
		children,
		actions
	}: { label: string; help: string; children: Snippet; actions?: Snippet } = $props();
</script>

<div class="field" role="group" aria-label={label}>
	<div class="head">
		<span class="label">{label}</span>
		<HelpTip text={help} label="About {label}" />
		{#if actions}<span class="actions">{@render actions()}</span>{/if}
	</div>
	{@render children()}
</div>

<style>
	:global(.field + .field) {
		margin-top: 16px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 6px;
	}
	.label {
		font-weight: 600;
		color: var(--heading);
		font-size: 0.875rem;
	}
	.actions {
		margin-left: auto;
		display: flex;
		gap: 4px;
	}
</style>
