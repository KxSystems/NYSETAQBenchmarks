import type { Component } from 'svelte';
import Intro from '../content/solutions-intro.svx';
import type { ResourceLink } from './types';

/**
 * The comparison is parameterised by what the compared series are. Only the solution
 * comparison exists in the first release; the hardware and thread-scaling pages will
 * supply their own configuration here (title, intro, links and series resolver).
 */
export interface ComparisonConfig {
	id: 'solutions';
	title: string;
	intro: Component;
	/** What one series is called in sentences, singular and plural. */
	seriesNoun: [string, string];
	links: ResourceLink[];
}

export const methodologyUrl = 'https://kx.com/blog/the-kx-nyse-taq-benchmark/';

export const solutionComparison: ComparisonConfig = {
	id: 'solutions',
	title: 'NYSE TAQ Benchmark — In-Memory Query Engines',
	intro: Intro,
	seriesNoun: ['solution', 'solutions'],
	links: [
		{
			label: 'Methodology and motivation',
			description: 'Why and how we benchmark',
			href: methodologyUrl,
			icon: 'book',
			external: true
		},
		{
			label: 'Reproduce and validate results',
			description: 'Run the benchmark yourself',
			href: 'https://github.com/KxSystems/NYSETAQBenchmarks',
			icon: 'play',
			external: true
		},
		{
			label: 'Add a solution',
			description: 'Benchmark your own engine',
			href: 'https://github.com/KxSystems/NYSETAQBenchmarks#adding-a-new-python-based-in-memory-query-engine',
			icon: 'plus',
			external: true
		}
	]
};
