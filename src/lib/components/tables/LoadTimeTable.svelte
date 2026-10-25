<script lang="ts">
	import { bandOf } from '../../model/bands';
	import { ratio } from '../../model/calc';
	import { formatRatioCompact, formatRatioSpoken, formatTime, formatTimeSpoken } from '../../model/format';
	import { loadRows, phaseLabel, phasesPresent, totalLoadNs } from '../../model/loadtime';
	import { useApp } from '../../state/app.svelte';
	import Swatch from '../ui/Swatch.svelte';

	const app = useApp();
	const r = $derived(app.resolved!);
	const rows = $derived(loadRows(r.compared, r.baseline));
	const phases = $derived(phasesPresent(app.ds!.load_phases, r.compared));
	const byId = $derived(new Map(r.compared.map((s) => [s.id, s])));
	const baseline = $derived(r.baseline);

	function cell(id: string, phase: string | null) {
		const s = byId.get(id)!;
		const t = phase === null ? totalLoadNs(s) : (s.m.load_ns[phase] ?? null);
		if (t === null) return null;
		const isBase = id === baseline?.id;
		const bt = baseline ? (phase === null ? totalLoadNs(baseline) : (baseline.m.load_ns[phase] ?? null)) : null;
		const rt = isBase ? null : ratio(t, bt);
		return {
			t,
			rt,
			band: rt === null ? 'similar' : bandOf(rt),
			label: `${phase === null ? 'Total' : phaseLabel(phase)}, ${id}: ${formatTimeSpoken(t)}${rt === null ? '' : `, ${formatRatioSpoken(rt, baseline!.label)}`}`
		};
	}
</script>

<section class="loadtable" aria-labelledby="loadtable-title">
	<h3 id="loadtable-title">Load time table</h3>
	{#if rows.length === 0}
		<p class="none">No results to show.</p>
	{:else}
		<div class="scroller" role="region" aria-label="Load time table" tabindex="-1">
			<table>
				<thead>
					<tr>
						<th class="first" scope="col">Phase</th>
						{#each rows as x (x.id)}
							<th scope="col" class:hl={app.hovered === x.id} onpointerenter={() => (app.hovered = x.id)} onpointerleave={() => (app.hovered = null)}>
								<span class="colhead"><Swatch style={byId.get(x.id)!.style} /><span>{x.id}</span></span>
								{#if x.id === baseline?.id}<span class="badge">baseline</span>{/if}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each [null, ...phases] as phase (phase ?? 'total')}
						<tr class:total={phase === null}>
							<th class="first" scope="row">{phase === null ? 'Total' : phaseLabel(phase)}</th>
							{#each rows as x (x.id)}
								{@const c = cell(x.id, phase)}
								{#if c}
									<td data-band={c.band} aria-label={c.label} class:hl={app.hovered === x.id}>
										<span class="time">{formatTime(c.t)}</span>
										{#if c.rt !== null}<span class="ratio">{formatRatioCompact(c.rt)}</span>{/if}
									</td>
								{:else}
									<td class="na" aria-label="{phaseLabel(phase!)}, {x.id}: not applicable">—</td>
								{/if}
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</section>

<style>
	.loadtable {
		position: relative;
		padding: 16px;
		background: var(--surface);
		border: 1px solid var(--border-subtle);
		border-radius: var(--radius-m);
		min-width: 0;
	}
	h3 {
		font-size: 1.0625rem;
		margin-bottom: 12px;
	}
	.scroller {
		overflow: auto;
		max-width: 100%;
	}
	table {
		border-collapse: separate;
		border-spacing: 0;
		min-width: 100%;
		font-size: 0.8125rem;
	}
	th,
	td {
		padding: 6px 10px;
		border-bottom: 1px solid var(--border-subtle);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	thead th {
		text-align: left;
		color: var(--heading);
		font-weight: 600;
		min-width: 120px;
		white-space: normal;
		background: var(--surface-subtle);
	}
	thead th.hl,
	td.hl {
		background-image: linear-gradient(var(--overlay), var(--overlay));
	}
	.first {
		position: sticky;
		left: 0;
		text-align: left;
		background: var(--surface);
		border-right: 1px solid var(--border);
		min-width: 130px;
	}
	thead .first {
		background: var(--surface-subtle);
	}
	.total th,
	.total td {
		font-weight: 700;
	}
	.colhead {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.badge {
		display: inline-block;
		margin-top: 2px;
		padding: 0 6px;
		border-radius: 8px;
		background: var(--brand);
		color: var(--on-brand);
		font-size: 0.6875rem;
		font-weight: 600;
	}
	.ratio {
		margin-left: 6px;
	}
	.na {
		color: var(--text-secondary);
		text-align: center;
	}
	.none {
		color: var(--text-secondary);
	}
</style>
