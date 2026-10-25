<script lang="ts">
	import { onMount } from 'svelte';

	// The earlier site published this page here; it now lives at /threads/.
	onMount(() => location.replace('/threads/'));
</script>

<svelte:head>
	<title>NYSE TAQ Benchmark — moved</title>
	<meta http-equiv="refresh" content="0; url=/threads/" />
	<link rel="canonical" href="https://benchmark.kx.com/threads/" />
	<meta name="robots" content="noindex" />
</svelte:head>

<p class="moved">This page has moved. <a href="/threads/">Open the NYSE TAQ benchmark</a>.</p>

<style>
	.moved {
		padding: 24px var(--gutter);
	}
</style>
