<script lang="ts">
	import { seriesColor, seriesFill, type SeriesStyle } from '../../model/colours';

	let { style, size = 12 }: { style: SeriesStyle; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" focusable="false" class="swatch">
	<rect
		x="0.75"
		y="0.75"
		width="10.5"
		height="10.5"
		rx="2.5"
		fill={seriesFill(style)}
		stroke={seriesColor(style)}
		stroke-width="1.5"
	/>
</svg>

<style>
	.swatch {
		flex: none;
		display: block;
	}
</style>
