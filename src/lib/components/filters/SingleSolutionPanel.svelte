<script lang="ts">
	import { solutionTip } from '../../model/describe';
	import { solutionsWithAnyRun } from '../../model/singlesolution';
	import { useApp } from '../../state/app.svelte';
	import Field from './Field.svelte';
	import Segmented, { type SegOption } from './Segmented.svelte';

	const app = useApp();
	const ds = $derived(app.ds!);
	const selected = $derived(app.resolved!.setup.solution ?? null);

	// A solution is dimmed when choosing it would leave nothing to compare under the current setup.
	const options = $derived<SegOption[]>(
		solutionsWithAnyRun(ds).map((n) => {
			const dim = !app.logic.hasResultsWith(ds, app.view, { solution: n });
			const t = solutionTip(ds, n);
			return {
				value: n,
				label: n,
				dim,
				tip: dim ? { ...t, lines: [...(t.lines ?? []), 'No results for this setup.'] } : t
			};
		})
	);
</script>

<Field label="Solution" help="The solution whose results are compared. Every chart shows this one solution.">
	<Segmented name="solution" label="Solution" {options} value={selected} onchange={(v) => app.set({ solution: v })} />
</Field>
