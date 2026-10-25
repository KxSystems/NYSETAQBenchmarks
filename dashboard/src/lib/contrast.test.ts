import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrast, themeTokens } from './contrast';

const css = readFileSync('src/app.css', 'utf8');
const BANDS = ['much-faster', 'faster', 'similar', 'slower', 'much-slower', 'failed'];

describe.each(['light', 'dark'] as const)('%s theme contrast (WCAG 2.2 AA)', (theme) => {
	const t = themeTokens(css, theme);
	const ratio = (fg: string, bg: string) => contrast(t[fg]!, t[bg]!);

	it('reads the tokens', () => {
		expect(t.bg).toMatch(/^#/);
		expect(t.s8).toMatch(/^#/);
	});

	it.each([
		['text', 'bg'],
		['text', 'surface'],
		['text', 'surface-subtle'],
		['text', 'brand-weak'],
		['heading', 'bg'],
		['heading', 'surface'],
		['text-secondary', 'bg'],
		['text-secondary', 'surface'],
		['text-secondary', 'surface-subtle'],
		['text', 'surface-strong'],
		['link', 'bg'],
		['link', 'surface'],
		['on-brand', 'brand'],
		['on-brand', 'hover-fill'],
		['tip-text', 'tip-bg']
	])('text %s on %s is at least 4.5:1', (fg, bg) => {
		expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
	});

	it.each(BANDS)('band %s: text on fill is at least 4.5:1', (band) => {
		expect(contrast(t[`band-${band}-text`]!, t[`band-${band}-bg`]!)).toBeGreaterThanOrEqual(4.5);
	});

	it.each(Array.from({ length: 8 }, (_, i) => `s${i + 1}`))('chart colour %s is at least 3:1 on the chart area', (s) => {
		expect(ratio(s, 'surface-subtle')).toBeGreaterThanOrEqual(3);
		expect(ratio(s, 'surface')).toBeGreaterThanOrEqual(3);
	});

	it('focus ring is at least 3:1 on page and surface', () => {
		expect(ratio('focus', 'bg')).toBeGreaterThanOrEqual(3);
		expect(ratio('focus', 'surface')).toBeGreaterThanOrEqual(3);
	});
});
