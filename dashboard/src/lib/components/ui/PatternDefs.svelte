<!-- Fill patterns for solutions beyond the eight palette colours: hatch (tier 1) and dots (tier 2). -->
<svg width="0" height="0" style="position: absolute" aria-hidden="true" focusable="false">
	<defs>
		{#each Array.from({ length: 8 }, (_, i) => i) as slot (slot)}
			<pattern id="pat-1-{slot}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
				<rect width="6" height="6" fill="var(--surface)" />
				<rect width="3" height="6" fill="var(--s{slot + 1})" />
			</pattern>
			<pattern id="pat-2-{slot}" width="6" height="6" patternUnits="userSpaceOnUse">
				<rect width="6" height="6" fill="var(--surface)" />
				<circle cx="3" cy="3" r="2" fill="var(--s{slot + 1})" />
			</pattern>
		{/each}
	</defs>
</svg>
