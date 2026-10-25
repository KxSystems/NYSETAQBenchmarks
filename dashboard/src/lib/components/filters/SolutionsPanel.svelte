<script lang="ts">
	import { solutionTip } from '../../model/describe';
	import { solutionOrder } from '../../model/colours';
	import { sortColumnsKey, sortColumnsLabel } from '../../model/format';
	import { solutionsWithRuns, styleMap } from '../../model/series';
	import { useApp } from '../../state/app.svelte';
	import Swatch from '../ui/Swatch.svelte';
	import Field from './Field.svelte';
	import ToggleChips, { type ChipOption } from './ToggleChips.svelte';

	const app = useApp();
	const ds = $derived(app.ds!);
	const names = $derived(solutionOrder(Object.keys(ds.solutions)));
	const styles = $derived(styleMap(ds));
	const withRuns = $derived(solutionsWithRuns(ds, app.resolved!.setup));

	const solutionOpts = $derived<ChipOption[]>(
		names.map((n) => {
			const t = solutionTip(ds, n);
			const dim = !withRuns.has(n);
			return {
				value: n,
				label: n,
				dim,
				tip: dim ? { ...t, lines: [...(t.lines ?? []), 'No results for this setup.'] } : t
			};
		})
	);

	const openOpts: ChipOption[] = [
		{ value: 'yes', label: 'Yes' },
		{ value: 'no', label: 'No' }
	];
	const sortOpts = $derived<ChipOption[]>(
		[...new Map(Object.values(ds.solutions).map((s) => [sortColumnsKey(s.sort_columns), s.sort_columns])).entries()]
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([key, cols]) => ({ value: key, label: cols ? sortColumnsLabel(cols) : 'Unknown' }))
	);
	const allSort = $derived(sortOpts.map((o) => o.value));
</script>

<Field label="Solution" help="Solutions to compare.">
	{#snippet actions()}
		<button type="button" class="btn small" onclick={() => app.set({ solutions: names })}>All</button>
		<button type="button" class="btn small" onclick={() => app.set({ solutions: [] })}>None</button>
	{/snippet}
	<ToggleChips
		options={solutionOpts}
		selected={app.solutionsSelected}
		onchange={(next) => app.set({ solutions: next })}
		onhover={(v) => (app.hovered = v)}
	>
		{#snippet lead(o)}<Swatch style={styles.get(o.value)!} />{/snippet}
	</ToggleChips>
</Field>

<Field label="Open source" help="Restrict to open-source or proprietary engines.">
	<ToggleChips
		options={openOpts}
		selected={app.view.openSource ?? ['yes', 'no']}
		onchange={(next) => app.set({ openSource: next as ('yes' | 'no')[] })}
	/>
</Field>

<Field label="Sort columns" help="Columns the trade and quote tables were sorted by when loaded.">
	{#snippet actions()}
		<button type="button" class="btn small" onclick={() => app.set({ sortCols: allSort })}>All</button>
		<button type="button" class="btn small" onclick={() => app.set({ sortCols: [] })}>None</button>
	{/snippet}
	<ToggleChips
		options={sortOpts}
		selected={app.view.sortCols ?? allSort}
		onchange={(next) => app.set({ sortCols: next })}
	/>
</Field>

<style>
	.small {
		min-height: 26px;
		padding: 0 8px;
		font-size: 0.8125rem;
	}
</style>
