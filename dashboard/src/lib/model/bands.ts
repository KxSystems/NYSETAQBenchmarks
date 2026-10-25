/** Ratio bands of spec section 7.4. Lower ratio = faster than the baseline. */
export type Band = 'much-faster' | 'faster' | 'similar' | 'slower' | 'much-slower' | 'failed';

export function bandOf(ratio: number): Exclude<Band, 'failed'> {
	if (ratio < 0.5) return 'much-faster';
	if (ratio < 0.9) return 'faster';
	if (ratio <= 1.1) return 'similar';
	if (ratio <= 2) return 'slower';
	return 'much-slower';
}

export const BAND_LEGEND: { band: Exclude<Band, 'failed'>; label: string; range: string }[] = [
	{ band: 'much-faster', label: 'Much faster', range: '< 0.5' },
	{ band: 'faster', label: 'Faster', range: '0.5 – < 0.9' },
	{ band: 'similar', label: 'Similar', range: '0.9 – 1.1' },
	{ band: 'slower', label: 'Slower', range: '> 1.1 – 2' },
	{ band: 'much-slower', label: 'Much slower', range: '> 2' }
];
