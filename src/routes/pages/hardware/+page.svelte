<script lang="ts">
	import { onMount } from 'svelte';

	// The earlier site published this page here; it now lives at /hardware/.
	onMount(() => location.replace('/hardware/'));
</script>

<svelte:head>
	<title>NYSE TAQ Benchmark — moved</title>
	<meta http-equiv="refresh" content="0; url=/hardware/" />
	<link rel="canonical" href="https://benchmark.kx.com/hardware/" />
	<meta name="robots" content="noindex" />
</svelte:head>

<p class="moved">This page has moved. <a href="/hardware/">Open the NYSE TAQ benchmark</a>.</p>

<style>
	.moved {
		padding: 24px var(--gutter);
	}
</style>
