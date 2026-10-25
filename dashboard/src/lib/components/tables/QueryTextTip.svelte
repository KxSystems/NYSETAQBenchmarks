<script lang="ts">
	let {
		anchor,
		text,
		language,
		title,
		onenter,
		onleave
	}: {
		anchor: HTMLElement;
		text: string | undefined;
		language: string | null;
		title: string;
		onenter: () => void;
		onleave: () => void;
	} = $props();

	let box = $state<HTMLDivElement>();
	let pos = $state({ left: -9999, top: -9999 });
	let copied = $state(false);

	// Below the cell, flipped above when it does not fit, clamped to the viewport.
	$effect(() => {
		if (!box) return;
		const place = () => {
			if (!box) return;
			const a = anchor.getBoundingClientRect();
			const w = box.offsetWidth;
			const h = box.offsetHeight;
			const vw = document.documentElement.clientWidth;
			const vh = window.innerHeight;
			let top = a.bottom + 4;
			if (top + h > vh - 8 && a.top - h - 4 >= 8) top = a.top - h - 4;
			top = Math.max(8, Math.min(top, vh - h - 8));
			const left = Math.max(8, Math.min(a.left, vw - w - 8));
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

	async function copy() {
		if (!text) return;
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = text;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			ta.remove();
		}
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}
</script>

<div
	bind:this={box}
	class="qtip"
	role="tooltip"
	style:left="{pos.left}px"
	style:top="{pos.top}px"
	onpointerenter={onenter}
	onpointerleave={onleave}
>
	<div class="head">
		<span class="title">{title}</span>
		{#if language}<span class="lang">{language}</span>{/if}
		{#if text}
			<button type="button" class="copy" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
		{/if}
	</div>
	{#if text}
		<pre>{text}</pre>
	{:else}
		<p>Query text is not available for this solution.</p>
	{/if}
</div>

<style>
	.qtip {
		position: fixed;
		z-index: 60;
		width: max-content;
		max-width: min(640px, calc(100vw - 16px));
		max-height: min(50vh, 420px);
		overflow: auto;
		padding: 8px 12px;
		border-radius: var(--radius-m);
		border: 1px solid var(--tip-border);
		background: var(--tip-bg);
		color: var(--tip-text);
		box-shadow: var(--shadow);
		font-size: 0.8125rem;
		text-align: left;
		font-weight: 400;
		cursor: default;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 6px;
	}
	.title {
		font-weight: 600;
		flex: 1;
	}
	.lang {
		padding: 0 6px;
		border: 1px solid currentColor;
		border-radius: 4px;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.copy {
		min-height: 24px;
		padding: 0 8px;
		border: 1px solid currentColor;
		border-radius: 4px;
		background: none;
		color: inherit;
		font-size: 0.75rem;
	}
	.copy:hover {
		background: color-mix(in srgb, currentColor 15%, transparent);
	}
	pre {
		margin: 0;
		font-family: var(--mono);
		font-size: 0.8125rem;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		tab-size: 4;
	}
	p {
		margin: 0;
	}
</style>
