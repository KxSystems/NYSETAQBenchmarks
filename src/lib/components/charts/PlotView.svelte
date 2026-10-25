<script lang="ts">
	/**
	 * Hosts an Observable Plot chart. `build` runs in the browser whenever the width or any
	 * state it reads changes; the SVG is decorative (the text alternative is provided by the
	 * parent as a table and by the interactive overlay).
	 */
	let { build }: { build: (width: number) => Element } = $props();

	let host = $state<HTMLDivElement>();
	let width = $state(0);

	$effect(() => {
		if (!host || width <= 0) return;
		const el = build(width);
		host.replaceChildren(el);
	});
</script>

<div bind:this={host} bind:clientWidth={width} class="plot" aria-hidden="true"></div>

<style>
	.plot {
		width: 100%;
		min-width: 0;
		color: var(--text);
	}
	.plot :global(svg) {
		display: block;
		max-width: 100%;
		overflow: visible;
	}
</style>
