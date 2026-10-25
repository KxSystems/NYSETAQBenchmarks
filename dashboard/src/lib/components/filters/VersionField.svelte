<script lang="ts">
	import { effectiveVersion, versionOptions } from '../../model/version';
	import { useApp } from '../../state/app.svelte';
	import Field from './Field.svelte';
	import Segmented, { type SegOption } from './Segmented.svelte';

	const app = useApp();
	// The unfiltered file: the other filters only see the selected version's runs.
	const raw = $derived(app.rawDs!);
	const options = $derived<SegOption[]>(versionOptions(raw).map((v) => ({ value: v, label: v })));
	const selected = $derived(effectiveVersion(raw, app.view.version));
</script>

{#if options.length > 0}
	<Field
		label="Benchmark version"
		help="Version of the benchmark (its query set and data schema) the results were produced with. Results of different versions are not comparable, so one version is shown at a time."
	>
		<Segmented name="version" label="Benchmark version" {options} value={selected} onchange={(v) => app.set({ version: v })} />
	</Field>
{/if}
