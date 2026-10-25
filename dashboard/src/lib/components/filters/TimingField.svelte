<script lang="ts">
	import { TIMINGS, TIMING_LABEL } from '../../data/types';
	import { useApp } from '../../state/app.svelte';
	import Field from './Field.svelte';
	import Segmented, { type SegOption } from './Segmented.svelte';

	const app = useApp();
	const timingOpts: SegOption[] = TIMINGS.map((t) => ({ value: t, label: TIMING_LABEL[t] }));
</script>

<Field
	label="Timing"
	help="Which of the three consecutive executions to compare. The cold run follows a cache flush."
>
	<Segmented name="timing" label="Timing" options={timingOpts} value={app.view.timing} onchange={(v) => app.set({ timing: v as 'cold' | 'hot' | 'hot2' })} />
</Field>
