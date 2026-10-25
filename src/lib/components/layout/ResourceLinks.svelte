<script lang="ts">
	import type { ResourceLink } from '../../config/types';
	import Icon from '../ui/Icon.svelte';

	let { links }: { links: ResourceLink[] } = $props();
</script>

<nav aria-label="Resources">
	<ul>
		{#each links as l (l.href)}
			<li>
				{#if l.current}
					<span class="card current" aria-current="page">
						<span class="icon"><Icon name={l.icon} size={20} /></span>
						<span class="text">
							<span class="label">{l.label}</span>
							<span class="desc">{l.description}</span>
						</span>
					</span>
				{:else}
					<a
						href={l.href}
						class="card"
						target={l.external ? '_blank' : undefined}
						rel={l.external ? 'noopener noreferrer' : undefined}
					>
						<span class="icon"><Icon name={l.icon} size={20} /></span>
						<span class="text">
							<span class="label">{l.label}</span>
							<span class="desc">{l.description}</span>
						</span>
						{#if l.external}
							<span class="ext"><Icon name="external" size={14} /><span class="sr-only">(opens in new tab)</span></span>
						{/if}
					</a>
				{/if}
			</li>
		{/each}
	</ul>
</nav>

<style>
	ul {
		position: relative; /* contains the visually hidden "opens in new tab" text inside the scroller */
		display: flex;
		gap: 12px;
		margin: 0;
		padding: 2px 2px 8px;
		list-style: none;
		overflow-x: auto;
	}
	@media (min-width: 900px) {
		ul {
			flex-wrap: wrap;
			overflow: visible;
			padding-bottom: 0;
		}
	}
	li {
		flex: 0 0 auto;
	}
	.card {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		min-height: 48px;
		border: 1px solid var(--border);
		border-radius: var(--radius-m);
		background: var(--surface);
		color: var(--text);
		text-decoration: none;
	}
	.card:hover {
		background: var(--brand-weak);
		border-color: var(--link);
		color: var(--text);
	}
	.card.current {
		background: var(--brand);
		border-color: var(--on-brand);
		cursor: default;
	}
	.card.current .label,
	.card.current .desc {
		color: var(--on-brand);
	}
	.card.current .icon {
		background: var(--surface);
		color: var(--heading);
	}
	.icon {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: var(--radius-s);
		background: var(--brand);
		color: var(--on-brand);
		flex: none;
	}
	.text {
		display: flex;
		flex-direction: column;
	}
	.label {
		font-weight: 600;
		color: var(--heading);
		font-size: 0.9375rem;
		line-height: 1.3;
	}
	.desc {
		display: none;
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}
	@media (min-width: 900px) {
		.desc {
			display: block;
		}
	}
	.ext {
		color: var(--text-secondary);
		display: grid;
	}
</style>
