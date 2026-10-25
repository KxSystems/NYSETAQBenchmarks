<script module lang="ts">
	import type { TipInput } from '../../state/tooltip.svelte';

	export interface SegOption {
		value: string;
		label: string;
		/** Tooltip text; when `dim` is set this should explain why. */
		tip?: TipInput;
		dim?: boolean;
	}
</script>

<script lang="ts">
	import { tip } from '../../state/tooltip.svelte';

	let {
		name,
		label,
		options,
		value,
		onchange
	}: {
		name: string;
		label: string;
		options: SegOption[];
		value: string | null;
		onchange: (v: string) => void;
	} = $props();
</script>

<div class="seg" role="radiogroup" aria-label={label}>
	{#each options as o (o.value)}
		<label class:dim={o.dim} class:on={o.value === value} use:tip={o.tip}>
			<input
				type="radio"
				{name}
				value={o.value}
				checked={o.value === value}
				onchange={() => onchange(o.value)}
			/>
			<span>{o.label}</span>
		</label>
	{/each}
</div>

<style>
	.seg {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	label {
		position: relative;
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		padding: 2px 12px;
		border-radius: var(--radius-s);
		background: var(--surface-strong);
		color: var(--text);
		font-size: 0.875rem;
		cursor: pointer;
	}
	label:hover {
		background: var(--hover-fill);
		color: var(--on-brand);
	}
	label.on {
		background: var(--brand);
		color: var(--on-brand);
		font-weight: 600;
	}
	label.dim {
		color: var(--text-disabled);
		font-style: italic;
	}
	label.dim.on {
		color: var(--on-brand);
	}
	input {
		position: absolute;
		inset: 0;
		opacity: 0;
		margin: 0;
		cursor: pointer;
	}
	label:has(input:focus-visible) {
		outline: 2px solid var(--focus);
		outline-offset: 2px;
	}
</style>
