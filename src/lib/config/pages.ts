import HardwareIntro from '../content/hardware-intro.svx';
import SolutionsIntro from '../content/solutions-intro.svx';
import ThreadsIntro from '../content/threads-intro.svx';
import HardwareSetupPanel from '../components/filters/HardwareSetupPanel.svelte';
import SetupPanel from '../components/filters/SetupPanel.svelte';
import SingleSolutionPanel from '../components/filters/SingleSolutionPanel.svelte';
import SolutionsPanel from '../components/filters/SolutionsPanel.svelte';
import ThreadsSetupPanel from '../components/filters/ThreadsSetupPanel.svelte';
import { hardwareLogic, solutionsLogic, threadsLogic, type PageId } from '../model/pages';
import type { PageConfig, ResourceLink } from './types';

export const methodologyUrl = 'https://kx.com/blog/the-kx-nyse-taq-benchmark/';

const externalLinks: ResourceLink[] = [
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
];

const pageLinks: Record<PageId, ResourceLink> = {
	hardware: {
		label: 'Hardware comparison',
		description: 'One solution across machines',
		href: '/hardware/',
		icon: 'hardware',
		external: false
	},
	threads: {
		label: 'Thread scaling',
		description: 'One solution across thread counts',
		href: '/threads/',
		icon: 'threads',
		external: false
	},
	solutions: {
		label: 'Solution comparison',
		description: 'Solutions side by side',
		href: '/',
		icon: 'solutions',
		external: false
	}
};

/** The three external links, then the other pages; the page itself is marked as current. */
export function linksFor(current: PageId): ResourceLink[] {
	const internal: PageId[] = current === 'solutions' ? ['hardware', 'threads'] : ['solutions', 'hardware', 'threads'];
	return [...externalLinks, ...internal.map((id) => ({ ...pageLinks[id], current: id === current }))];
}

export const solutionsPage: PageConfig = {
	id: 'solutions',
	logic: solutionsLogic,
	title: 'NYSE TAQ Benchmark — In-Memory Query Engines',
	description: 'Query and data load performance of in-memory query engines on NYSE TAQ data.',
	intro: SolutionsIntro,
	links: linksFor('solutions'),
	SolutionsPanel,
	SetupPanel
};

export const hardwarePage: PageConfig = {
	id: 'hardware',
	logic: hardwareLogic,
	title: 'NYSE TAQ Benchmark — Hardware Comparison',
	description: 'Query and data load performance of one solution on different machines, at the same thread count.',
	intro: HardwareIntro,
	links: linksFor('hardware'),
	SolutionsPanel: SingleSolutionPanel,
	SetupPanel: HardwareSetupPanel
};

export const threadsPage: PageConfig = {
	id: 'threads',
	logic: threadsLogic,
	title: 'NYSE TAQ Benchmark — Thread Scaling',
	description: "How one solution's query and data load performance scales with the number of threads.",
	intro: ThreadsIntro,
	links: linksFor('threads'),
	SolutionsPanel: SingleSolutionPanel,
	SetupPanel: ThreadsSetupPanel
};
