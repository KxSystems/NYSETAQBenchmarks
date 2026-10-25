<script lang="ts">
	import { machineTip } from '../../model/describe';
	import {
		hardwareDateOptions,
		hardwareMachineOptions,
		hardwareNumaOptions,
		hardwareSetup,
		hardwareThreadOptions,
		machineHasResults,
		machineStyleMap
	} from '../../model/hardware';
	import { useApp } from '../../state/app.svelte';
	import Swatch from '../ui/Swatch.svelte';
	import Field from './Field.svelte';
	import Segmented, { type SegOption } from './Segmented.svelte';
	import SizeField from './SizeField.svelte';
	import VersionField from './VersionField.svelte';
	import TimingField from './TimingField.svelte';
	import ToggleChips, { type ChipOption } from './ToggleChips.svelte';

	const app = useApp();
	const ds = $derived(app.ds!);
	const setup = $derived(hardwareSetup(ds, app.view));
	const styles = $derived(machineStyleMap(ds));

	const allMachines = $derived(hardwareMachineOptions(ds, setup.solution));
	const machineOpts = $derived<ChipOption[]>(
		allMachines.map((m) => {
			const dim = !machineHasResults(ds, setup, m);
			const t = machineTip(m, ds.machines[m]!);
			const why = `No run of ${setup.solution} with ${setup.threads ?? '?'} threads on this machine${setup.date ? ` on ${setup.date}` : ''}.`;
			return { value: m, label: m, dim, tip: dim ? { ...t, lines: [...(t.lines ?? []), why] } : t };
		})
	);

	const dateOpts = $derived<SegOption[]>(
		hardwareDateOptions(ds, setup.solution, setup.machines).map((d) => {
			const dim = !app.logic.hasResultsWith(ds, app.view, { date: d, threads: null, numa: null });
			return { value: d, label: d, dim, tip: dim ? `No results for ${d} with the selected machines` : undefined };
		})
	);
	const allNuma = $derived(hardwareNumaOptions(ds, setup.solution, setup.machines, setup.date));
	const numaOpts = $derived<ChipOption[]>(
		allNuma.map((n) => {
			const dim = !app.logic.hasResultsWith(ds, app.view, { numa: [n] });
			return { value: n, label: n === 'all' ? 'all' : `node ${n}`, dim, tip: dim ? `No results for NUMA node ${n} with the current setup` : undefined };
		})
	);
	const threadOpts = $derived<SegOption[]>(
		hardwareThreadOptions(ds, setup.solution, setup.machines, setup.date).map((t) => {
			const dim = !app.logic.hasResultsWith(ds, app.view, { threads: t });
			return { value: t, label: t, dim, tip: dim ? `No results for ${t} threads on the selected machines` : undefined };
		})
	);
</script>

<VersionField />
<SizeField />

<Field label="Machines" help="Machines to compare. Only machines with runs of the selected solution are listed.">
	{#snippet actions()}
		<button type="button" class="btn small" onclick={() => app.set({ machines: allMachines })}>All</button>
		<button type="button" class="btn small" onclick={() => app.set({ machines: [] })}>None</button>
	{/snippet}
	<ToggleChips
		options={machineOpts}
		selected={setup.machines}
		onchange={(next) => app.set({ machines: next })}
		onhover={(v) => (app.hovered = v)}
	>
		{#snippet lead(o)}<Swatch style={styles.get(o.value)!} />{/snippet}
	</ToggleChips>
</Field>

<Field label="Data date" help="Trading day of the TAQ data.">
	<Segmented name="date" label="Data date" options={dateOpts} value={setup.date} onchange={(v) => app.set({ date: v })} />
</Field>

<Field label="NUMA node" help="NUMA node the process was pinned to; “all” means not pinned.">
	{#snippet actions()}
		<button type="button" class="btn small" onclick={() => app.set({ numa: allNuma })}>All</button>
		<button type="button" class="btn small" onclick={() => app.set({ numa: [] })}>None</button>
	{/snippet}
	<ToggleChips options={numaOpts} selected={setup.numa} onchange={(next) => app.set({ numa: next })} />
</Field>

<Field label="Threads" help="Number of threads the engine was allowed to use. The same for every machine.">
	<Segmented name="threads" label="Threads" options={threadOpts} value={setup.threads} onchange={(v) => app.set({ threads: v })} />
</Field>

<TimingField />

<style>
	.small {
		min-height: 26px;
		padding: 0 8px;
		font-size: 0.8125rem;
	}
</style>
