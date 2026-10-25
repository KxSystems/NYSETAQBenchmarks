<script lang="ts">
	import { machineTip } from '../../model/describe';
	import {
		threadsDateOptions,
		threadsMachineOptions,
		threadsNumaOptions,
		threadsSetup
	} from '../../model/threads';
	import { useApp } from '../../state/app.svelte';
	import Swatch from '../ui/Swatch.svelte';
	import Field from './Field.svelte';
	import Segmented, { type SegOption } from './Segmented.svelte';
	import SizeField from './SizeField.svelte';
	import TimingField from './TimingField.svelte';
	import ToggleChips, { type ChipOption } from './ToggleChips.svelte';

	const app = useApp();
	const ds = $derived(app.ds!);
	const setup = $derived(threadsSetup(ds, app.view));

	const machineOpts = $derived<SegOption[]>(
		threadsMachineOptions(ds, setup.solution).map((m) => {
			const dim = !app.logic.hasResultsWith(ds, app.view, { machine: m, date: null, numa: null, pairs: null });
			const t = machineTip(m, ds.machines[m]!);
			return { value: m, label: m, dim, tip: dim ? { ...t, lines: [...(t.lines ?? []), `No thread-count results for ${setup.solution} on this machine.`] } : t };
		})
	);
	const dateOpts = $derived<SegOption[]>(
		threadsDateOptions(ds, setup.solution, setup.machine).map((d) => {
			const dim = !app.logic.hasResultsWith(ds, app.view, { date: d, numa: null, pairs: null });
			return { value: d, label: d, dim, tip: dim ? `No results for ${d} on this machine` : undefined };
		})
	);
	const allNuma = $derived(threadsNumaOptions(ds, setup.solution, setup.machine, setup.date));
	const numaOpts = $derived<ChipOption[]>(
		allNuma.map((n) => {
			const dim = !app.logic.hasResultsWith(ds, app.view, { numa: [n], pairs: null });
			return { value: n, label: n === 'all' ? 'all' : `node ${n}`, dim, tip: dim ? `No thread-count results for NUMA node ${n}` : undefined };
		})
	);

	const available = $derived(setup.available);
	const selected = $derived(app.view.pairs ? available.filter((p) => app.view.pairs!.includes(p.id)).map((p) => p.id) : available.map((p) => p.id));
	const pairOpts = $derived<ChipOption[]>(available.map((p) => ({ value: p.id, label: p.label, tip: p.tip })));
	const styles = $derived(new Map(available.map((p) => [p.id, p.style])));
</script>

<SizeField />

<Field label="Machine" help="Hardware the benchmark ran on. Machines are listed with the most measured thread counts first.">
	<Segmented name="machine" label="Machine" options={machineOpts} value={setup.machine} onchange={(v) => app.set({ machine: v, pairs: null })} />
</Field>

<Field label="Data date" help="Trading day of the TAQ data.">
	<Segmented name="date" label="Data date" options={dateOpts} value={setup.date} onchange={(v) => app.set({ date: v })} />
</Field>

<Field label="NUMA node" help="NUMA node the process was pinned to; “all” means not pinned. The selected nodes decide which runs contribute thread counts.">
	{#snippet actions()}
		<button type="button" class="btn small" onclick={() => app.set({ numa: allNuma })}>All</button>
		<button type="button" class="btn small" onclick={() => app.set({ numa: [] })}>None</button>
	{/snippet}
	<ToggleChips options={numaOpts} selected={setup.numa} onchange={(next) => app.set({ numa: next })} />
</Field>

<Field label="Threads" help="Thread counts to compare. A thread count that was measured under more than one NUMA node is listed once per node.">
	{#snippet actions()}
		<button type="button" class="btn small" onclick={() => app.set({ pairs: available.map((p) => p.id) })}>All</button>
		<button type="button" class="btn small" onclick={() => app.set({ pairs: [] })}>None</button>
	{/snippet}
	<ToggleChips
		options={pairOpts}
		{selected}
		onchange={(next) => app.set({ pairs: next })}
		onhover={(v) => (app.hovered = v)}
	>
		{#snippet lead(o)}<Swatch style={styles.get(o.value)!} />{/snippet}
	</ToggleChips>
</Field>

<TimingField />

<style>
	.small {
		min-height: 26px;
		padding: 0 8px;
		font-size: 0.8125rem;
	}
</style>
