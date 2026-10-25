<script module lang="ts">
	import type { TipInput } from '../../state/tooltip.svelte';

	export interface ChipOption {
		value: string;
		label: string;
		tip?: TipInput;
		dim?: boolean;
		disabled?: boolean;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { tip } from '../../state/tooltip.svelte';

	let {
		options,
		selected,
		onchange,
		onhover,
		lead
	}: {
		options: ChipOption[];
		selected: string[];
		onchange: (next: string[]) => void;
		/** Called with the option's value on hover/focus and null when it ends. */
		onhover?: (value: string | null) => void;
		/** Rendered before the label, e.g. a colour swatch. */
		lead?: Snippet<[ChipOption]>;
	} = $props();

	function toggle(v: string) {
		onchange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
	}
</script>

<div class="chips">
	{#each options as o (o.value)}
		<button
			type="button"
			class="chip"
			class:on={selected.includes(o.value)}
			class:dim={o.dim}
			aria-pressed={selected.includes(o.value)}
			aria-disabled={o.disabled || undefined}
			onclick={() => !o.disabled && toggle(o.value)}
			onpointerenter={() => onhover?.(o.value)}
			onpointerleave={() => onhover?.(null)}
			onfocus={() => onhover?.(o.value)}
			onblur={() => onhover?.(null)}
			use:tip={o.tip}
		>
			{#if lead}{@render lead(o)}{/if}
			<span>{o.label}</span>
		</button>
	{/each}
</div>

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-height: 32px;
		padding: 2px 10px;
		border: 1px solid transparent;
		border-radius: var(--radius-s);
		background: var(--surface-strong);
		color: var(--text);
		font-size: 0.875rem;
		text-align: left;
	}
	.chip:hover {
		background: var(--hover-fill);
		color: var(--on-brand);
	}
	.chip.on {
		background: var(--brand);
		color: var(--on-brand);
		border-color: var(--on-brand);
	}
	.chip.on::before {
		content: '✓';
		font-size: 0.75rem;
	}
	.chip.dim {
		color: var(--text-disabled);
		font-style: italic;
	}
	.chip.dim.on {
		color: var(--on-brand);
	}
	.chip[aria-disabled='true'] {
		opacity: 0.55;
		cursor: not-allowed;
	}
</style>
