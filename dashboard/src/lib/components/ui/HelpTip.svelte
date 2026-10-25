<script lang="ts">
	import { tip } from '../../state/tooltip.svelte';
	import Icon from './Icon.svelte';

	let { text, label = 'Help' }: { text: string; label?: string } = $props();
</script>

<button type="button" class="help" aria-label={label} use:tip={text}>
	<Icon name="info" size={14} />
</button>

<style>
	.help {
		display: inline-grid;
		place-items: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border: 0;
		border-radius: 50%;
		background: none;
		color: var(--text-secondary);
	}
	.help:hover {
		color: var(--link);
	}
</style>
