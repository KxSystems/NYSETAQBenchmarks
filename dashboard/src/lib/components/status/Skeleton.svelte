<div class="skeleton" aria-busy="true" aria-label="Loading results">
	<div class="bar"></div>
	<div class="block tall"></div>
	<div class="two"><div class="block"></div><div class="block"></div></div>
</div>

<style>
	.skeleton {
		display: grid;
		gap: 16px;
		margin-top: 16px;
	}
	.bar {
		height: 56px;
		border-radius: var(--radius-m);
		background: var(--surface-strong);
	}
	.block {
		height: 260px;
		border-radius: var(--radius-m);
		background: var(--surface-strong);
	}
	.block.tall {
		height: 320px;
	}
	.two {
		display: grid;
		gap: 16px;
		grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
	}
	@media (prefers-reduced-motion: no-preference) {
		.bar,
		.block {
			animation: pulse 1.4s ease-in-out infinite;
		}
		@keyframes pulse {
			50% {
				opacity: 0.55;
			}
		}
	}
</style>
