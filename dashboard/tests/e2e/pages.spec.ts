import { expect, test, type Page } from '@playwright/test';

const status = (page: Page) => page.getByRole('status', { name: 'Comparison summary' });
const nav = (page: Page) => page.getByRole('navigation', { name: 'Resources' });

test.describe('hardware comparison page', () => {
	test('renders the default view', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

		await page.goto('/hardware/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('NYSE TAQ Benchmark — Hardware Comparison');
		await expect(page.getByText('Query and data load performance of one solution on different machines')).toBeVisible();
		await expect(status(page)).toHaveText(
			/^Comparing KDB-X on 2 machines on 81 of 84 queries · large · 2026-04-01 · 4 threads · cold run · baseline AMD_EPYC_9575F\s*$/
		);
		await expect(page.getByRole('heading', { name: /relative to/ })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Wins per machine' })).toBeVisible();
		await expect(page.locator('section[aria-labelledby="geomean-title"] .label .name', { hasText: 'INTEL_XEON_6738P' })).toBeVisible();
		expect(page.url()).not.toContain('?');
		expect(errors).toEqual([]);
	});

	test('marks the current page in the resource links', async ({ page }) => {
		await page.goto('/hardware/');
		await expect(nav(page).locator('[aria-current="page"]')).toContainText('Hardware comparison');
		await expect(nav(page).getByRole('link', { name: /Hardware comparison/ })).toHaveCount(0);
		await expect(nav(page).getByRole('link', { name: /Solution comparison/ })).toHaveAttribute('href', '/');
		await expect(nav(page).getByRole('link', { name: /Thread scaling/ })).toHaveAttribute('href', '/threads/');
	});

	test('has a single solution choice and a machines filter, without open-source and sort filters', async ({ page }) => {
		await page.goto('/hardware/');
		await page.getByRole('button', { name: /^Solutions/ }).click();
		await expect(page.getByRole('radiogroup', { name: 'Solution' })).toBeVisible();
		await expect(page.getByText('Open source')).toHaveCount(0);
		await expect(page.getByText('Sort columns')).toHaveCount(0);
		await page.getByRole('radio', { name: 'Pandas', exact: true }).check({ force: true });
		await expect(page).toHaveURL(/solution=Pandas/);
		await expect(status(page)).toContainText('Comparing Pandas on 1 machine (+1 failed)');
		await expect(page.getByText('Failed — exit 137')).toBeVisible();

		await page.getByRole('button', { name: 'Close Solutions filters' }).click();
		await page.getByRole('button', { name: /^Setup/ }).click();
		await expect(page.getByRole('button', { name: /^AMD_EPYC_9575F/ }).first()).toBeVisible();
		await expect(page.getByText('Machines', { exact: true })).toBeVisible();
	});

	test('hovering a machine shows its full specification', async ({ page }) => {
		await page.goto('/hardware/');
		await page.getByRole('button', { name: /^Setup/ }).click();
		await page.getByRole('button', { name: /INTEL_XEON_6738P/ }).first().hover();
		const tip = page.getByRole('tooltip').first();
		await expect(tip).toContainText('Intel(R) Xeon(R) 6738P');
		await expect(tip).toContainText('CoresPerSocket');
		await expect(tip).toContainText('TotalGB');
	});

	test('deselecting a machine and choosing the baseline update the view and the URL', async ({ page }) => {
		await page.goto('/hardware/');
		await page.getByRole('combobox', { name: /Baseline/ }).first().selectOption('INTEL_XEON_6738P');
		await expect(status(page)).toContainText('baseline INTEL_XEON_6738P');
		await expect(page).toHaveURL(/baseline=INTEL_XEON_6738P/);
		await page.getByRole('button', { name: 'Remove AMD_EPYC_9575F' }).click();
		await expect(status(page)).toContainText('Comparing KDB-X on 1 machine');
		await expect(page).toHaveURL(/machines=INTEL_XEON_6738P/);
	});

	test('the breakdown has a column per machine and shows the solution\'s query text', async ({ page }) => {
		await page.goto('/hardware/?bd=1');
		const heads = page.locator('#breakdown thead th');
		await expect(heads.nth(1)).toContainText('AMD_EPYC_9575F');
		await expect(heads.nth(2)).toContainText('INTEL_XEON_6738P');
		await page.locator('td[data-cell]').nth(1).hover();
		await expect(page.getByRole('tooltip').filter({ hasText: 'Copy' })).toContainText('Q1 · INTEL_XEON_6738P');
	});

	test('the load time tab shows memory and data size per machine', async ({ page }) => {
		await page.goto('/hardware/?tab=load');
		await expect(page.getByRole('heading', { name: 'Max resident memory (GB)' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Data size in memory (GB)' })).toBeVisible();
		await expect(page.getByRole('heading', { name: /Total load time/ })).toBeVisible();
	});

	test('restores a view from the URL, and a copied link restores this page', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await page.goto('/hardware/?solution=pykx&threads=128&timing=hot');
		await expect(status(page)).toContainText('Comparing pykx on 1 machine');
		await expect(status(page)).toContainText('128 threads · hot run');
		await page.getByRole('button', { name: 'Copy link' }).click();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/hardware\/\?solution=pykx&threads=128&timing=hot$/);
	});

	test('reset restores the page defaults', async ({ page }) => {
		await page.goto('/hardware/?solution=pykx&size=full');
		await page.getByRole('button', { name: 'Reset filters' }).click();
		await expect(status(page)).toContainText('Comparing KDB-X on 2 machines');
		await expect(page).not.toHaveURL(/\?/);
	});
});

test.describe('thread scaling page', () => {
	test('renders the default view', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

		await page.goto('/threads/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('NYSE TAQ Benchmark — Thread Scaling');
		await expect(status(page)).toHaveText(
			/^KDB-X on INTEL_XEON_6738P at 6 thread counts on 81 of 84 queries · large · 2026-04-01 · cold run · baseline 1 thread\s*$/
		);
		await expect(nav(page).locator('[aria-current="page"]')).toContainText('Thread scaling');
		await expect(page.getByRole('heading', { name: 'Wins per thread count' })).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('lists the thread counts in ascending order, in the chart and the breakdown', async ({ page }) => {
		await page.goto('/threads/?bd=1');
		await expect(status(page)).toContainText('at 6 thread counts');
		const labels = await page.locator('section[aria-labelledby="geomean-title"] .label .name').allTextContents();
		expect(labels).toEqual(['1 thread', '4 threads', '16 threads', '32 threads', '64 threads', '128 threads']);
		const heads = await page.locator('#breakdown thead th').allTextContents();
		expect(heads.slice(1).map((h) => h.replace(/baseline/, '').trim())).toEqual(labels);
	});

	test('labels a thread count measured under two NUMA nodes with its node', async ({ page }) => {
		await page.goto('/threads/?solution=pykx&machine=AMD_EPYC_9575F');
		await expect(status(page)).toContainText('pykx on AMD_EPYC_9575F');
		const labels = await page.locator('section[aria-labelledby="geomean-title"] .label .name').allTextContents();
		expect(labels).toContain('128 threads (node 0)');
		expect(labels).toContain('128 threads (all nodes)');
	});

	test('the Threads filter selects pairs, and the NUMA filter decides which runs contribute', async ({ page }) => {
		await page.goto('/threads/');
		await page.getByRole('button', { name: /^Setup/ }).click();
		const setup = page.locator('#panel-setup');
		await setup.getByRole('button', { name: /32 threads$/ }).click();
		await expect(status(page)).toContainText('at 5 thread counts');
		await expect(page).toHaveURL(/pairs=/);
		await setup.getByRole('button', { name: /^✓?\s*all$/ }).click(); // NUMA node all off: 128 threads disappears
		await expect(status(page)).toContainText('at 4 thread counts');
	});

	test('draws the linear scaling line on the log scale', async ({ page }) => {
		await page.goto('/threads/');
		const chart = page.locator('section[aria-labelledby="geomean-title"] svg');
		await expect(chart.first()).toBeVisible();
		await expect(chart.getByText('linear scaling')).toHaveCount(0);
		await page.getByRole('button', { name: 'Log' }).click();
		await expect(chart.getByText('linear scaling')).toBeVisible();
		await expect(page).toHaveURL(/scale=log/);
	});

	test('the baseline is a thread count', async ({ page }) => {
		await page.goto('/threads/');
		await page.getByRole('combobox', { name: /Baseline/ }).first().selectOption('4@0');
		await expect(status(page)).toContainText('baseline 4 threads');
		await expect(page).toHaveURL(/baseline=4@0/);
	});

	test('the load time tab replaces the memory charts with a note per run', async ({ page }) => {
		await page.goto('/threads/?tab=load');
		await expect(page.getByRole('heading', { name: 'Max resident memory (GB)' })).toHaveCount(0);
		await expect(page.getByText(/Peak memory [\d.]+ GB and data size [\d.]+ GB \(node 0 run\); [\d.]+ GB and [\d.]+ GB \(unpinned run\)/)).toBeVisible();
		await expect(page.getByRole('heading', { name: /Total load time/ })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Load time table' })).toBeVisible();
	});

	test('shows the empty state with the exit code when the only runs failed', async ({ page }) => {
		await page.goto('/threads/?solution=Pandas&machine=INTEL_XEON_6738P');
		await expect(page.getByRole('heading', { name: 'Pandas failed on this machine: exit 137' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Reset filters' }).last()).toBeVisible();
	});

	test('restores a view from the URL and ignores invalid values', async ({ page }) => {
		await page.goto('/threads/?machine=AMD_EPYC_9575F&pairs=1@0,64@0,999@0&timing=hot&size=nope');
		await expect(status(page)).toContainText('at 2 thread counts');
		await expect(status(page)).toContainText('hot run');
		await expect(status(page)).toContainText('AMD_EPYC_9575F');
	});
});

test.describe('all pages: themes and phone width', () => {
	for (const path of ['/', '/hardware/', '/threads/']) {
		for (const scheme of ['light', 'dark'] as const) {
			test(`${path} renders in the ${scheme} theme`, async ({ browser }) => {
				const ctx = await browser.newContext({ colorScheme: scheme });
				const page = await ctx.newPage();
				const errors: string[] = [];
				page.on('pageerror', (e) => errors.push(e.message));
				page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
				await page.goto(path);
				await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
				await expect(status(page)).toContainText(/Comparing|KDB-X on/);
				expect(errors).toEqual([]);
				await ctx.close();
			});
		}
	}

	test.describe('at 360px', () => {
		test.use({ viewport: { width: 360, height: 780 } });
		for (const path of ['/hardware/', '/hardware/?tab=load', '/hardware/?bd=1', '/threads/', '/threads/?tab=load', '/threads/?bd=1&scale=log']) {
			test(`${path} does not scroll the page horizontally`, async ({ page }) => {
				await page.goto(path);
				await expect(status(page)).toContainText(/Comparing|KDB-X on/);
				const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
				expect(sw).toBeLessThanOrEqual(iw);
			});
		}
	});
});
