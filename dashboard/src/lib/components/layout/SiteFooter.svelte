<script lang="ts">
	function openCookies() {
		// Only does something when the consent manager is on the page.
		window.OneTrust?.ToggleInfoDisplay?.();
	}
</script>

<footer>
	<p>
		KX® and kdb+ are registered trademarks of KX Systems, Inc., a subsidiary of KX Software Limited.
	</p>
	<p class="links">
		<a href="https://kx.com/privacy-policy/" target="_blank" rel="noopener noreferrer"
			>Privacy Policy<span class="sr-only"> (opens in new tab)</span></a
		>
		<button type="button" class="linklike" onclick={openCookies}>Cookie Settings</button>
	</p>
</footer>

<style>
	footer {
		margin-top: 48px;
		padding-block: 24px 48px;
		border-top: 1px solid var(--border-subtle);
		font-size: 0.875rem;
		color: var(--text-secondary);
	}
	p {
		margin: 0 0 8px;
	}
	.links {
		display: flex;
		gap: 16px;
	}
	.linklike {
		background: none;
		border: 0;
		padding: 0;
		color: var(--link);
		text-decoration: underline;
		font-size: inherit;
	}
	.linklike:hover {
		color: var(--link-hover);
	}
</style>
