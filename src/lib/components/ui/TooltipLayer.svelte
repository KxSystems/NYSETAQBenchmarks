<script lang="ts">
	import { hideTip, TOOLTIP_ID, tooltip, type SpecEntry } from '../../state/tooltip.svelte';

	let box = $state<HTMLDivElement>();
	let pos = $state({ left: 0, top: 0 });

	// Place below the anchor, flip above if it does not fit, keep inside the viewport.
	$effect(() => {
		const anchor = tooltip.anchor;
		void tooltip.content;
		if (!anchor || !box) return;
		const place = () => {
			if (!box || !anchor.isConnected) return;
			const a = anchor.getBoundingClientRect();
			const w = box.offsetWidth;
			const h = box.offsetHeight;
			const vw = document.documentElement.clientWidth;
			const vh = window.innerHeight;
			let top = a.bottom + 8;
			if (top + h > vh - 8 && a.top - h - 8 >= 8) top = a.top - h - 8;
			top = Math.max(8, Math.min(top, vh - h - 8));
			let left = a.left + a.width / 2 - w / 2;
			left = Math.max(8, Math.min(left, vw - w - 8));
			pos = { left, top };
		};
		place();
		addEventListener('scroll', place, true);
		addEventListener('resize', place);
		return () => {
			removeEventListener('scroll', place, true);
			removeEventListener('resize', place);
		};
	});

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && tooltip.anchor) hideTip();
	}
	function onDown(e: PointerEvent) {
		if (tooltip.anchor && e.pointerType === 'touch' && !tooltip.anchor.contains(e.target as Node)) hideTip();
	}
</script>

<svelte:window onkeydown={onKey} onpointerdown={onDown} />

{#snippet entries(list: SpecEntry[])}
	<dl>
		{#each list as e (e.key)}
			{#if e.children}
				<dt>{e.key}</dt>
				<dd class="nested">{@render entries(e.children)}</dd>
			{:else}
				<dt>{e.key}</dt>
				<dd>{e.value}</dd>
			{/if}
		{/each}
	</dl>
{/snippet}

<div
	bind:this={box}
	id={TOOLTIP_ID}
	role="tooltip"
	class="tooltip"
	hidden={!tooltip.content}
	style:left="{pos.left}px"
	style:top="{pos.top}px"
>
	{#if tooltip.content}
		{#if tooltip.content.title}<strong>{tooltip.content.title}</strong>{/if}
		{#each tooltip.content.lines ?? [] as line, i (i)}<p>{line}</p>{/each}
		{#each tooltip.content.groups ?? [] as g (g.heading)}
			<section>
				<h4>{g.heading}</h4>
				{@render entries(g.entries)}
			</section>
		{/each}
	{/if}
</div>

<style>
	.tooltip {
		position: fixed;
		z-index: 100;
		max-width: min(420px, calc(100vw - 16px));
		max-height: calc(100vh - 16px);
		overflow: auto;
		padding: 8px 12px;
		border-radius: var(--radius-m);
		border: 1px solid var(--tip-border);
		background: var(--tip-bg);
		color: var(--tip-text);
		font-size: 0.875rem;
		box-shadow: var(--shadow);
		pointer-events: none;
	}
	.tooltip[hidden] {
		display: none;
	}
	p {
		margin: 0;
	}
	p + p,
	strong + p {
		margin-top: 4px;
	}
	h4 {
		margin: 8px 0 2px;
		font-size: 0.75rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		opacity: 0.8;
	}
	dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0 12px;
		margin: 0;
	}
	dt {
		opacity: 0.8;
	}
	dd {
		margin: 0;
		overflow-wrap: anywhere;
	}
	dd.nested {
		grid-column: 1 / -1;
		padding-left: 16px;
	}
</style>
