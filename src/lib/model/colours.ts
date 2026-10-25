import { compareNames } from './format';

export const PALETTE_SIZE = 8;

export interface SeriesStyle {
	/** 0-based position in the alphabetical list of all solutions in the file. */
	index: number;
	/** Palette slot, 0..7. */
	slot: number;
	/** 0 = solid fill; 1, 2... = hatch patterns for solutions beyond the palette. */
	tier: number;
}

export function styleFor(index: number): SeriesStyle {
	return { index, slot: index % PALETTE_SIZE, tier: Math.floor(index / PALETTE_SIZE) };
}

/** Solution names in alphabetical order; their positions fix the colours. */
export function solutionOrder(names: Iterable<string>): string[] {
	return [...names].sort(compareNames);
}

const TIER_COUNT = 3;

/** CSS paint for a series: a solid palette colour, or a hatch/dot pattern beyond the palette. */
export function seriesFill(style: SeriesStyle): string {
	if (style.tier === 0) return `var(--s${style.slot + 1})`;
	return `url(#pat-${Math.min(style.tier, TIER_COUNT - 1)}-${style.slot})`;
}

export function seriesColor(style: SeriesStyle): string {
	return `var(--s${style.slot + 1})`;
}

export const PATTERN_TIERS = [1, 2];
