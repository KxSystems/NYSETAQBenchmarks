import { readdirSync } from 'node:fs';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { mdsvex } from 'mdsvex';
import { defineConfig } from 'vitest/config';

/** Sizes in the order the filter shows them; other sizes follow alphabetically. */
const SIZE_ORDER = ['full', 'xlarge', 'large', 'medium', 'small', 'tiny'];

/** The data sizes that have a file in static/data/ (written by pysrc/convertToJSON.py). */
function dataSizes(): string[] {
	const rank = (s: string) => (SIZE_ORDER.includes(s) ? SIZE_ORDER.indexOf(s) : SIZE_ORDER.length);
	return readdirSync('static/data')
		.filter((f) => f.endsWith('.json'))
		.map((f) => f.slice(0, -'.json'.length))
		.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export default defineConfig({
	define: {
		__DATA_SIZES__: JSON.stringify(dataSizes())
	},
	plugins: [
		sveltekit({
			extensions: ['.svelte', '.svx'],
			preprocess: [vitePreprocess(), mdsvex({ extensions: ['.svx'] })],
			adapter: adapter({ pages: 'build', assets: 'build', strict: true }),
			paths: { relative: false }
		})
	],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'node'
	}
});
