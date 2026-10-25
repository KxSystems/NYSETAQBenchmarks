<script lang="ts" module>
	import type { SeriesStyle } from '../../model/colours';
	import type { TipInput } from '../../state/tooltip.svelte';

	export interface Segment {
		key: string;
		value: number;
		fill: string;
		stroke?: string;
	}

	export interface VBar {
		id: string;
		style: SeriesStyle;
		segments: Segment[];
		/** Label above the bar, e.g. `3` or `n/a`. */
		text: string;
		ariaLabel: string;
		tip: TipInput;
		onclick?: () => void;
	}
</script>

<script lang="ts">
	import * as Plot from '@observablehq/plot';
	import { useApp } from '../../state/app.svelte';
	import { tip } from '../../state/tooltip.svelte';
	import Swatch from '../ui/Swatch.svelte';
	import PlotView from './PlotView.svelte';

	let {
		bars,
		yMax,
		yTicks,
		yFormat = (d: number) => String(d)
	}: {
		bars: VBar[];
		yMax: number;
		yTicks?: number[];
		yFormat?: (d: number) => string;
	} = $props();

	const app = useApp();
	const H = 220;
	const MT = 24;
	const ML = 48;
	const MR = 8;
	const COL = 64;

	const total = (b: VBar) => b.segments.reduce((s, x) => s + x.value, 0);

	function build(width: number) {
		const flat = bars.flatMap((b) => {
			let acc = 0;
			return b.segments
				.filter((s) => s.value > 0)
				.map((s) => ({ id: b.id, y1: acc, y2: (acc += s.value), fill: s.fill, stroke: s.stroke ?? s.fill }));
		});
		const empty = bars.filter((b) => total(b) === 0);
		// Keep the bars' side gaps proportional when the chart is momentarily very narrow.
		const gap = Math.max(0, Math.min(10, (width - ML - MR) / Math.max(1, bars.length) / 4));
		return Plot.plot({
			width,
			height: H,
			marginTop: MT,
			marginBottom: 1,
			marginLeft: ML,
			marginRight: MR,
			style: { background: 'transparent', color: 'var(--text)', fontFamily: 'var(--font)', fontSize: '12px', overflow: 'visible' },
			x: { domain: bars.map((b) => b.id), axis: null, padding: 0 },
			y: { domain: [0, yMax], grid: true, label: null, ticks: yTicks, tickFormat: yFormat },
			marks: [
				Plot.barY(flat, { x: 'id', y1: 'y1', y2: 'y2', fill: 'fill', stroke: 'stroke', strokeWidth: 1, insetLeft: gap, insetRight: gap }),
				Plot.barY(empty, { x: 'id', y1: 0, y2: yMax * 0.015, fill: 'none', stroke: 'var(--border)', insetLeft: gap, insetRight: gap }),
				Plot.ruleY([0], { stroke: 'var(--border)' }),
				Plot.text(bars, {
					x: 'id',
					y: (b: VBar) => total(b),
					text: 'text',
					dy: -8,
					fill: 'var(--text)',
					fontWeight: 600,
					fontSize: 12
				})
			]
		});
	}
</script>

<div class="scroll">
	<div class="inner" style:min-width="{ML + MR + bars.length * COL}px">
		<div class="plotwrap">
			<PlotView {build} />
			<div class="hits" style:margin-left="{ML}px" style:margin-right="{MR}px" style:grid-template-columns="repeat({bars.length}, 1fr)" style:height="{H}px">
				{#each bars as b (b.id)}
					<button
						type="button"
						class="hit"
						class:hl={app.hovered === b.id}
						aria-label={b.ariaLabel}
						disabled={!b.onclick}
						use:tip={b.tip}
						onclick={b.onclick}
						onpointerenter={() => (app.hovered = b.id)}
						onpointerleave={() => (app.hovered = null)}
						onfocus={() => (app.hovered = b.id)}
						onblur={() => (app.hovered = null)}
					></button>
				{/each}
			</div>
		</div>
		<ol class="names" style:margin-left="{ML}px" style:margin-right="{MR}px" style:grid-template-columns="repeat({bars.length}, 1fr)">
			{#each bars as b (b.id)}
				<li class:hl={app.hovered === b.id}>
					<Swatch style={b.style} />
					<span>{b.id}</span>
				</li>
			{/each}
		</ol>
	</div>
</div>

<style>
	.scroll {
		overflow-x: auto;
		max-width: 100%;
	}
	.inner {
		position: relative;
	}
	.plotwrap {
		position: relative;
	}
	.hits {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		display: grid;
	}
	.hit {
		height: 100%;
		padding: 0;
		border: 0;
		background: transparent;
	}
	.hit:disabled {
		cursor: default;
	}
	.hit:not(:disabled) {
		cursor: pointer;
	}
	.hit.hl,
	.hit:hover {
		background: color-mix(in srgb, var(--brand) 30%, transparent);
	}
	.names {
		display: grid;
		margin-top: 6px;
		margin-bottom: 0;
		margin-inline: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 2px 3px;
		font-size: 0.75rem;
		line-height: 1.2;
		text-align: center;
		color: var(--heading);
		overflow-wrap: anywhere;
		border-radius: var(--radius-s);
	}
	li.hl {
		background: var(--brand-weak);
	}
</style>
