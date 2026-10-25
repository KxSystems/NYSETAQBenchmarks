<script lang="ts">
	import { machineTip } from '../../model/describe';
	import { hasResultsWith } from '../../model/options';
	import { dateOptions, machineOptions, numaOptions, threadOptions } from '../../model/setup';
	import { useApp } from '../../state/app.svelte';
	import Field from './Field.svelte';
	import SizeField from './SizeField.svelte';
	import VersionField from './VersionField.svelte';
	import TimingField from './TimingField.svelte';
	import Segmented, { type SegOption } from './Segmented.svelte';
	import ToggleChips, { type ChipOption } from './ToggleChips.svelte';

	const app = useApp();
	const ds = $derived(app.ds!);
	const setup = $derived(app.resolved!.setup);

	const dimTip = (text: string, dim: boolean) => (dim ? text : undefined);

	const machineOpts = $derived<SegOption[]>(
		machineOptions(ds).map((m) => {
			const dim = !hasResultsWith(ds, app.view, { machine: m, date: null, threads: null, numa: null });
			const t = machineTip(m, ds.machines[m]!);
			return {
				value: m,
				label: m,
				dim,
				tip: dim ? { ...t, lines: [...(t.lines ?? []), 'No results for this machine with the current setup.'] } : t
			};
		})
	);
	const dateOpts = $derived<SegOption[]>(
		dateOptions(ds, setup.machine).map((d) => {
			const dim = !hasResultsWith(ds, app.view, { date: d, threads: null, numa: null });
			return { value: d, label: d, dim, tip: dimTip(`No results for ${d} on this machine`, dim) };
		})
	);
	const numaOpts = $derived<ChipOption[]>(
		numaOptions(ds, setup.machine, setup.date).map((n) => {
			const dim = !hasResultsWith(ds, app.view, { numa: [n] });
			return {
				value: n,
				label: n === 'all' ? 'all' : `node ${n}`,
				dim,
				tip: dim ? `No results for NUMA node ${n} with the current setup` : undefined
			};
		})
	);
	const threadOpts = $derived<SegOption[]>(
		threadOptions(ds, setup.machine, setup.date).map((t) => {
			const dim = !hasResultsWith(ds, app.view, { threads: t });
			return { value: t, label: t, dim, tip: dimTip(`No results for ${t} threads on this machine`, dim) };
		})
	);
	const allNuma = $derived(numaOptions(ds, setup.machine, setup.date));
</script>

<VersionField />
<SizeField />

<Field label="Machine" help="Hardware the benchmark ran on.">
	<Segmented name="machine" label="Machine" options={machineOpts} value={setup.machine} onchange={(v) => app.set({ machine: v })} />
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

<Field label="Threads" help="Number of threads the engine was allowed to use.">
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
