<script lang="ts">
	import { SIZES } from '../../data/load';
	import { useApp } from '../../state/app.svelte';
	import Field from './Field.svelte';
	import Segmented, { type SegOption } from './Segmented.svelte';

	const app = useApp();
	const sizeOpts: SegOption[] = SIZES.map((s) => ({ value: s, label: s }));
</script>

<Field label="Data size" help="Amount of TAQ data loaded.">
	<Segmented name="size" label="Data size" options={sizeOpts} value={app.view.size} onchange={(v) => app.set({ size: v })} />
</Field>
