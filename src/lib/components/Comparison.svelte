<script lang="ts">
	import { onMount } from 'svelte';
	import type { PageConfig } from '../config/types';
	import Notes from '../content/notes.svx';
	import { App, provideApp } from '../state/app.svelte';
	import FailuresChart from './charts/FailuresChart.svelte';
	import GeoMeanChart from './charts/GeoMeanChart.svelte';
	import LoadTimeChart from './charts/LoadTimeChart.svelte';
	import MemoryChart from './charts/MemoryChart.svelte';
	import MemoryNote from './charts/MemoryNote.svelte';
	import WinsPie from './charts/WinsPie.svelte';
	import FilterBar from './filters/FilterBar.svelte';
	import SiteFooter from './layout/SiteFooter.svelte';
	import SiteHeader from './layout/SiteHeader.svelte';
	import ResourceLinks from './layout/ResourceLinks.svelte';
	import Message from './status/Message.svelte';
	import Skeleton from './status/Skeleton.svelte';
	import StatusLine from './status/StatusLine.svelte';
	import LoadTimeTable from './tables/LoadTimeTable.svelte';
	import QueryBreakdown from './tables/QueryBreakdown.svelte';
	import PatternDefs from './ui/PatternDefs.svelte';
	import Tabs from './ui/Tabs.svelte';
	import TooltipLayer from './ui/TooltipLayer.svelte';
	import { dataSizeBars, peakMemoryBars } from '../model/loadtime';

	let { page }: { page: PageConfig } = $props();

	// One page per component instance: the page never changes after creation.
	// svelte-ignore state_referenced_locally
	const app = new App(page);
	provideApp(app);
	onMount(() => app.init());
	$effect(() => app.syncUrl());

	const Intro = $derived(page.intro);
	const r = $derived(app.resolved);
</script>

<svelte:head>
	<title>{page.title}</title>
	<meta name="description" content={page.description} />
</svelte:head>

<a class="skip" href="#results">Skip to results</a>
<PatternDefs />
<TooltipLayer />

<div class="wrap head">
	<SiteHeader title={page.title} />
	<ResourceLinks links={page.links} />
	<div class="intro"><Intro /></div>
</div>

{#if app.status === 'ready' && r}
	<FilterBar />
{:else}
	<div class="barstub"></div>
{/if}

<main id="results" class="wrap" tabindex="-1">
	{#if app.status === 'error'}
		<Message title="The {app.view.size} data could not be loaded">
			{app.error}
			{#snippet actions()}
				<button type="button" class="btn primary" onclick={() => app.retry()}>Retry</button>
			{/snippet}
		</Message>
	{:else if !r || app.status === 'loading'}
		<Skeleton />
	{:else}
		<StatusLine />
		<Tabs
			label="Result views"
			value={app.view.tab}
			tabs={[
				{ id: 'queries', label: 'Query statistics' },
				{ id: 'load', label: 'Load time statistics' }
			]}
			onchange={(id) => app.set({ tab: id as 'queries' | 'load' })}
		/>
		<div id="tabpanel" role="tabpanel" aria-labelledby="tab-{app.view.tab}" tabindex="-1" class="panel">
			{#if r.compared.length === 0 && r.failed.length === 0}
				<Message title={r.emptyReason ?? 'No results match the selected filters'}>
					{#snippet actions()}
						<button type="button" class="btn primary" onclick={() => app.togglePanel('solutions')}>Open the Solutions filter</button>
						<button type="button" class="btn" onclick={() => app.reset()}>Reset filters</button>
					{/snippet}
				</Message>
			{:else if app.view.tab === 'queries'}
				{#if r.comparedQueries.length === 0}
					<Message title="No queries match the query filters">
						{#snippet actions()}
							<button type="button" class="btn primary" onclick={() => app.togglePanel('queries')}>Open the Queries filter</button>
						{/snippet}
					</Message>
				{:else}
					<div class="stack">
						<GeoMeanChart />
						<div class="pair">
							<FailuresChart />
							<WinsPie />
						</div>
					</div>
				{/if}
				{#if !app.view.breakdownOpen}
					<p class="reveal">
						<button type="button" class="btn primary" onclick={() => app.openBreakdown(null)}>Show query breakdown</button>
					</p>
				{:else}
					<QueryBreakdown />
				{/if}
			{:else}
				<p class="note">
					These charts describe whole runs, so the query filters and the timing do not apply.
				</p>
				<div class="stack">
					{#if app.logic.memory === 'charts'}
						<div class="pair">
							<MemoryChart
								id="memory"
								title="Max resident memory (GB)"
								subtitle="Peak memory of the benchmark process"
								data={peakMemoryBars(r.compared)}
								noun="Peak memory"
							/>
							<MemoryChart
								id="datasize"
								title="Data size in memory (GB)"
								subtitle="Size of the loaded tables, as reported by the engine"
								data={dataSizeBars(r.compared)}
								noun="Data size"
							/>
						</div>
					{:else}
						<MemoryNote />
					{/if}
					<LoadTimeChart />
					<LoadTimeTable />
				</div>
			{/if}
		</div>
	{/if}

	<Notes />
	<SiteFooter />
</main>

<style>
	.skip {
		position: absolute;
		left: 8px;
		top: -48px;
		z-index: 200;
		padding: 8px 14px;
		background: var(--brand);
		color: var(--on-brand);
		border-radius: var(--radius-s);
	}
	.skip:focus {
		top: 8px;
	}
	.head {
		padding-bottom: 12px;
	}
	.intro {
		margin-top: 12px;
		max-width: 80ch;
		color: var(--text-secondary);
	}
	.intro :global(p) {
		margin: 0;
	}
	.barstub {
		height: 53px;
		border-block: 1px solid var(--border-subtle);
	}
	main {
		outline: none;
	}
	.panel {
		margin-top: 16px;
		outline: none;
	}
	.stack {
		display: grid;
		gap: 16px;
	}
	.pair {
		display: grid;
		gap: 16px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr));
		min-width: 0;
	}
	.reveal {
		margin: 24px 0 0;
		text-align: center;
	}
	.note {
		margin: 0 0 12px;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}
	main :global(.notes) {
		margin-top: 32px;
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	main :global(.notes h2) {
		font-size: 1rem;
		margin-bottom: 8px;
	}
</style>
