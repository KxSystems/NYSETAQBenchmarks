<script lang="ts">
	import { instrumentRefinementLabel } from '../../model/format';
	import {
		allInstrumentTokens,
		complexityOptions,
		effectiveExcludeTags,
		instrumentOptions,
		tagOptions
	} from '../../model/queries';
	import { useApp } from '../../state/app.svelte';
	import Field from './Field.svelte';
	import ToggleChips, { type ChipOption } from './ToggleChips.svelte';

	const app = useApp();
	const ds = $derived(app.ds!);
	const scopes = $derived(instrumentOptions(ds));
	const allTokens = $derived(allInstrumentTokens(ds));
	const selectedTokens = $derived(app.view.instruments ?? allTokens);
	const complexity = $derived(complexityOptions(ds));
	const tags = $derived(tagOptions(ds));
	const tagOpts = $derived<ChipOption[]>(tags.map((t) => ({ value: t, label: t, tip: ds.tags[t] })));
	const cxOpts = $derived<ChipOption[]>(complexity.map((c) => ({ value: c, label: c })));

	function toggleToken(t: string) {
		app.set({
			instruments: selectedTokens.includes(t) ? selectedTokens.filter((x) => x !== t) : [...selectedTokens, t]
		});
	}
</script>

<p class="count" aria-live="polite">
	{app.resolved!.queries.length} of {ds.queries.length} queries match
</p>

<Field
	label="Instrument"
	help="How many instruments the query works on: one, a list, or the full universe."
>
	{#snippet actions()}
		<button type="button" class="btn small" onclick={() => app.set({ instruments: allTokens })}>All</button>
		<button type="button" class="btn small" onclick={() => app.set({ instruments: [] })}>None</button>
	{/snippet}
	<div class="tree">
		{#each scopes as s (s.scope)}
			<div class="scope">
				<button
					type="button"
					class="chip"
					class:on={selectedTokens.includes(s.scope)}
					aria-pressed={selectedTokens.includes(s.scope)}
					onclick={() => toggleToken(s.scope)}
				>
					{s.scope === 'all' ? 'all (no filter)' : s.scope}
				</button>
				{#each s.refinements as r (r)}
					{@const off = !selectedTokens.includes(s.scope)}
					<button
						type="button"
						class="chip sub"
						class:on={selectedTokens.includes(r)}
						aria-pressed={selectedTokens.includes(r)}
						aria-disabled={off || undefined}
						disabled={off}
						onclick={() => toggleToken(r)}
					>
						{instrumentRefinementLabel(r.slice(r.indexOf(':') + 1))}
					</button>
				{/each}
			</div>
		{/each}
	</div>
</Field>

<Field label="Complexity" help="How involved the query logic is.">
	<ToggleChips options={cxOpts} selected={app.view.complexity ?? complexity} onchange={(next) => app.set({ complexity: next })} />
</Field>

<Field
	label="Include tags"
	help="Only queries carrying at least one selected tag. None selected = no restriction."
>
	<ToggleChips options={tagOpts} selected={app.view.includeTags} onchange={(next) => app.set({ includeTags: next })} />
</Field>

<Field label="Exclude tags" help="Queries carrying any selected tag are left out.">
	<ToggleChips options={tagOpts} selected={effectiveExcludeTags(app.view)} onchange={(next) => app.set({ excludeTags: next })} />
</Field>

<style>
	.count {
		margin: 0 0 12px;
		font-weight: 600;
		color: var(--heading);
	}
	.tree {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.scope {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px;
	}
	.chip {
		min-height: 32px;
		padding: 2px 10px;
		border: 1px solid transparent;
		border-radius: var(--radius-s);
		background: var(--surface-strong);
		color: var(--text);
		font-size: 0.875rem;
	}
	.chip:hover:not(:disabled) {
		background: var(--hover-fill);
		color: var(--on-brand);
	}
	.chip.on {
		background: var(--brand);
		color: var(--on-brand);
		border-color: var(--on-brand);
	}
	.chip.on::before {
		content: '✓ ';
		font-size: 0.75rem;
	}
	.chip.sub {
		margin-left: 4px;
		font-size: 0.8125rem;
	}
	.chip:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}
	.small {
		min-height: 26px;
		padding: 0 8px;
		font-size: 0.8125rem;
	}
</style>
