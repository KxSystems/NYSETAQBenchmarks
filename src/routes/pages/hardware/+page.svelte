<script lang="ts">
	import { onMount } from 'svelte';

	// The earlier site published this page here. Until the new pages exist it points to the main page.
	onMount(() => location.replace('/'));
</script>

<svelte:head>
	<title>NYSE TAQ Benchmark — moved</title>
	<meta http-equiv="refresh" content="0; url=/" />
	<link rel="canonical" href="https://benchmark.kx.com/" />
	<meta name="robots" content="noindex" />
</svelte:head>

<p class="moved">This page has moved. <a href="/">Open the NYSE TAQ benchmark</a>.</p>

<style>
	.moved {
		padding: 24px var(--gutter);
	}
</style>
