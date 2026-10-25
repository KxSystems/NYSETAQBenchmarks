<script lang="ts">
	import { TIMING_LABEL } from '../../data/types';
	import { threadsLabel } from '../../model/format';
	import { useApp, type PanelId } from '../../state/app.svelte';
	import Icon from '../ui/Icon.svelte';
	import FilterPanel from './FilterPanel.svelte';
	import QueriesPanel from './QueriesPanel.svelte';
	import SetupPanel from './SetupPanel.svelte';
	import SolutionsPanel from './SolutionsPanel.svelte';

	const app = useApp();
	const r = $derived(app.resolved!);
	const onLoadTab = $derived(app.view.tab === 'load');

	const groups: { id: PanelId; label: string }[] = [
		{ id: 'solutions', label: 'Solutions' },
		{ id: 'setup', label: 'Setup' },
		{ id: 'queries', label: 'Queries' }
	];

	const chips = $derived<{ group: PanelId; text: string; dim?: boolean }[]>([
		{ group: 'solutions', text: `${r.compared.length + r.failed.length} solutions` },
		{ group: 'setup', text: app.view.size },
		{ group: 'setup', text: r.setup.machine ?? 'no machine' },
		{ group: 'setup', text: threadsLabel(r.setup.threads) },
		onLoadTab
			? { group: 'setup', text: 'n/a on this tab', dim: true }
			: { group: 'setup', text: TIMING_LABEL[app.view.timing] },
		{
			group: 'queries',
			text: onLoadTab ? 'queries n/a on this tab' : `${r.comparedQueries.length}/${app.ds!.queries.length} queries`,
			dim: onLoadTab
		}
	]);

	const buttons: Record<string, HTMLButtonElement> = {};

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || app.openPanels.length === 0) return;
		const focused = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('section.panel');
		const id = (focused?.id.replace('panel-', '') as PanelId | undefined) ?? app.openPanels[app.openPanels.length - 1]!;
		app.closePanel(id);
		buttons[id]?.focus();
	}
</script>

<svelte:window onkeydown={onKey} />

<div class="bar">
	<div class="wrap">
		<div class="row">
			<div class="groups" role="group" aria-label="Filter groups">
				{#each groups as g (g.id)}
					<button
						bind:this={buttons[g.id]}
						type="button"
						class="group"
						class:open={app.openPanels.includes(g.id)}
						aria-expanded={app.openPanels.includes(g.id)}
						aria-controls="panel-{g.id}"
						onclick={() => app.togglePanel(g.id)}
					>
						{g.label}
						<span class="caret"><Icon name="chevron" size={14} /></span>
					</button>
				{/each}
			</div>
			<ul class="chips" aria-label="Active filters">
				{#each chips as c, i (i)}
					<li>
						<button type="button" class="summary" class:dim={c.dim} onclick={() => app.togglePanel(c.group)}>
							{c.text}
						</button>
					</li>
				{/each}
			</ul>
			<div class="actions">
				<button type="button" class="btn" onclick={() => app.reset()}>
					<Icon name="reset" size={16} /> Reset filters
				</button>
				<button type="button" class="btn" onclick={() => app.copyLink()}>
					<Icon name={app.linkCopied ? 'check' : 'link'} size={16} />
					{app.linkCopied ? 'Link copied' : 'Copy link'}
				</button>
				<span class="sr-only" role="status">{app.linkCopied ? 'Link copied' : ''}</span>
			</div>
		</div>
		{#if app.openPanels.length}
			<div class="panels">
				{#each app.openPanels as id (id)}
					{#if id === 'solutions'}
						<FilterPanel id="panel-solutions" title="Solutions" onclose={() => app.closePanel('solutions')}>
							<SolutionsPanel />
						</FilterPanel>
					{:else if id === 'setup'}
						<FilterPanel id="panel-setup" title="Setup" onclose={() => app.closePanel('setup')}>
							<SetupPanel />
						</FilterPanel>
					{:else}
						<FilterPanel id="panel-queries" title="Queries" onclose={() => app.closePanel('queries')}>
							<QueriesPanel />
						</FilterPanel>
					{/if}
				{/each}
			</div>
		{/if}
	</div>
</div>

<style>
	.bar {
		position: sticky;
		top: 0;
		z-index: 30;
		background: var(--bg);
		border-block: 1px solid var(--border-subtle);
	}
	.row {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px 16px;
		padding-block: 8px;
	}
	.groups {
		display: flex;
		gap: 6px;
	}
	.group {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 36px;
		padding: 4px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-s);
		background: var(--surface);
		font-weight: 600;
		color: var(--heading);
	}
	.group:hover {
		background: var(--hover-fill);
		color: var(--on-brand);
	}
	.group.open {
		background: var(--brand);
		color: var(--on-brand);
	}
	.caret {
		display: grid;
		transition: transform 120ms;
	}
	.open .caret {
		transform: rotate(180deg);
	}
	.chips {
		display: flex;
		flex: 1 1 200px;
		gap: 6px;
		min-width: 0;
		margin: 0;
		padding: 0;
		list-style: none;
		overflow-x: auto;
		scrollbar-width: thin;
	}
	.summary {
		white-space: nowrap;
		min-height: 28px;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: 14px;
		background: var(--brand-weak);
		color: var(--text);
		font-size: 0.8125rem;
	}
	.summary:hover {
		background: var(--hover-fill);
		color: var(--on-brand);
	}
	.summary.dim {
		color: var(--text-disabled);
		font-style: italic;
	}
	.actions {
		display: flex;
		gap: 6px;
		margin-left: auto;
	}
	.panels {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 8px var(--gutter) 0;
		max-width: var(--max-width);
		margin-inline: auto;
		pointer-events: none;
	}
	.bar > .wrap {
		position: relative;
	}
	.bar > .wrap > .panels {
		top: 100%;
		left: 0;
		right: 0;
	}
	@media (max-width: 639.98px) {
		.groups {
			width: 100%;
		}
		.group {
			flex: 1;
			justify-content: center;
		}
		.actions {
			width: 100%;
		}
		.actions .btn {
			flex: 1;
			justify-content: center;
		}
		.panels {
			display: contents;
		}
	}
</style>
