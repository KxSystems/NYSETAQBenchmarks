<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '../ui/Icon.svelte';

	let theme = $state<'light' | 'dark'>('light');

	onMount(() => {
		theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
		// Follow the operating system until the visitor has chosen.
		const mq = matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => {
			let stored: string | null = null;
			try {
				stored = localStorage.getItem('theme');
			} catch {}
			if (stored === 'light' || stored === 'dark') return;
			apply(mq.matches ? 'dark' : 'light', false);
		};
		mq.addEventListener('change', onChange);
		return () => mq.removeEventListener('change', onChange);
	});

	function apply(next: 'light' | 'dark', remember: boolean) {
		theme = next;
		document.documentElement.setAttribute('data-theme', next);
		if (remember) {
			try {
				localStorage.setItem('theme', next);
			} catch {}
		}
	}
</script>

<button
	type="button"
	class="btn toggle"
	aria-pressed={theme === 'dark'}
	onclick={() => apply(theme === 'dark' ? 'light' : 'dark', true)}
>
	<Icon name={theme === 'dark' ? 'moon' : 'sun'} />
	<span class="label">{theme === 'dark' ? 'Dark' : 'Light'} theme</span>
</button>

<style>
	.toggle {
		white-space: nowrap;
	}
	@media (max-width: 479px) {
		.label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip-path: inset(50%);
		}
	}
</style>
