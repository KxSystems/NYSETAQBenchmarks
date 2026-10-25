<script lang="ts">
	import Logo from './Logo.svelte';
	import ThemeToggle from './ThemeToggle.svelte';

	let { title }: { title: string } = $props();
</script>

<header class="top">
	<a class="logo" href="https://kx.com" target="_blank" rel="noopener noreferrer">
		<Logo />
		<span class="sr-only">KX (opens in new tab)</span>
	</a>
	<h1>{title}</h1>
	<div class="theme"><ThemeToggle /></div>
</header>

<style>
	.top {
		display: flex;
		align-items: center;
		gap: 16px;
		padding-block: 16px 12px;
	}
	.logo {
		display: block;
		flex: none;
	}
	h1 {
		flex: 1;
		font-size: clamp(1.125rem, 1rem + 1vw, 1.75rem);
		font-weight: 700;
		min-width: 0;
	}
	.theme {
		flex: none;
	}
</style>
