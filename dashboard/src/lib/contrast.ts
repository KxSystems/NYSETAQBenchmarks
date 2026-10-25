/** WCAG 2.x contrast ratio between two #rrggbb colours. */
function lum(hex: string): number {
	const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
	const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)) as [number, number, number];
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
	return (hi + 0.05) / (lo + 0.05);
}

/** Read the custom properties of one theme block out of the stylesheet text. */
export function themeTokens(css: string, theme: 'light' | 'dark'): Record<string, string> {
	const selector = theme === 'light' ? ":root,\n:root[data-theme='light'] {" : ":root[data-theme='dark'] {";
	const start = css.indexOf(selector);
	if (start < 0) throw new Error(`theme block not found: ${theme}`);
	const body = css.slice(start + selector.length, css.indexOf('\n}', start));
	const out: Record<string, string> = {};
	for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
	return out;
}
