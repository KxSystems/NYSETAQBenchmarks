<script lang="ts">
	let {
		tabs,
		value,
		onchange,
		label
	}: {
		tabs: { id: string; label: string }[];
		value: string;
		onchange: (id: string) => void;
		label: string;
	} = $props();

	let list = $state<HTMLDivElement>();

	function onKey(e: KeyboardEvent) {
		const i = tabs.findIndex((t) => t.id === value);
		let n = i;
		if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
		else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
		else if (e.key === 'Home') n = 0;
		else if (e.key === 'End') n = tabs.length - 1;
		else return;
		e.preventDefault();
		onchange(tabs[n]!.id);
		list?.querySelectorAll<HTMLElement>('[role=tab]')[n]?.focus();
	}
</script>

<div bind:this={list} class="tabs" role="tablist" aria-label={label} tabindex="-1" onkeydown={onKey}>
	{#each tabs as t (t.id)}
		<button
			type="button"
			role="tab"
			id="tab-{t.id}"
			aria-selected={t.id === value}
			aria-controls="tabpanel"
			tabindex={t.id === value ? 0 : -1}
			class:on={t.id === value}
			onclick={() => onchange(t.id)}
		>
			{t.label}
		</button>
	{/each}
</div>

<style>
	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 2px solid var(--border-subtle);
		overflow-x: auto;
	}
	button {
		min-height: 44px;
		padding: 0 18px;
		border: 0;
		border-bottom: 3px solid transparent;
		margin-bottom: -2px;
		background: none;
		font-weight: 600;
		color: var(--text-secondary);
		white-space: nowrap;
	}
	button:hover {
		color: var(--heading);
		background: var(--brand-weak);
	}
	button.on {
		color: var(--heading);
		border-bottom-color: var(--link);
	}
</style>
