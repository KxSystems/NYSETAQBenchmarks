import { expect, test, type Page } from '@playwright/test';

const status = (page: Page) => page.getByRole('status', { name: 'Comparison summary' });

test.describe('solution comparison page', () => {
	test('renders the default view', async ({ page }) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

		await page.goto('/');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('NYSE TAQ Benchmark — In-Memory Query Engines');
		await expect(status(page)).toContainText('Comparing 5 solutions');
		await expect(status(page)).toContainText('AMD_EPYC_9575F · full · 2026-04-01 · 4 threads · cold run · baseline KDB-X');

		// three charts of the Query statistics tab
		await expect(page.getByRole('heading', { name: /Geometric mean of per-query time ratios/ })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Query failures' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Wins per solution' })).toBeVisible();
		await expect(page.locator('section[aria-labelledby="geomean-title"] svg').first()).toBeVisible();
		await expect(page.getByText('Failed — exit 137')).toBeVisible();

		// panels and breakdown are hidden initially
		await expect(page.locator('section.panel')).toHaveCount(0);
		await expect(page.getByRole('heading', { name: 'Query breakdown' })).toHaveCount(0);
		expect(page.url()).not.toContain('?');
		expect(errors).toEqual([]);
	});

	test('filter panels open independently and close with Esc', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: /^Solutions/ }).click();
		await page.getByRole('button', { name: /^Setup/ }).click();
		await expect(page.locator('section.panel')).toHaveCount(2);
		await page.keyboard.press('Escape');
		await expect(page.locator('section.panel')).toHaveCount(1);
		await page.getByRole('button', { name: 'Close Solutions filters' }).click();
		await expect(page.locator('section.panel')).toHaveCount(0);
	});

	test('a filter change updates the charts and the URL; size changes add history entries', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: /^Setup/ }).click();
		await page.getByRole('radio', { name: '16' }).check({ force: true });
		await expect(status(page)).toContainText('16 threads');
		expect(page.url()).toContain('threads=16');

		await page.getByRole('radio', { name: 'large', exact: true }).check({ force: true });
		await expect(page).toHaveURL(/size=large/);
		await expect(status(page)).toContainText('large');
		await page.goBack();
		await expect(page).not.toHaveURL(/size=large/);
		await expect(status(page)).toContainText('full');
		await expect(status(page)).toContainText('16 threads');
	});

	test('restores a view from the URL and ignores invalid values', async ({ page }) => {
		await page.goto('/?timing=hot&threads=16&solutions=KDB-X,Pandas&scale=log&bogus=1&size=nope');
		await expect(status(page)).toContainText('Comparing 2 solutions');
		await expect(status(page)).toContainText('16 threads · hot run');
		await expect(page.getByRole('button', { name: 'Log' })).toHaveAttribute('aria-pressed', 'true');
	});

	test('reset restores the defaults', async ({ page }) => {
		await page.goto('/?threads=16&timing=hot');
		await page.getByRole('button', { name: 'Reset filters' }).click();
		await expect(page).not.toHaveURL(/threads=/);
		await expect(status(page)).toContainText('4 threads · cold run');
	});

	test('a chart mark opens the query breakdown, cells show query text, ticking changes the aggregates', async ({ page }) => {
		await page.goto('/');
		await page.locator('section[aria-labelledby="geomean-title"]').getByRole('button', { name: /^KDB-X \(Manual Opt\)/ }).click();
		await expect(page.getByRole('heading', { name: 'Query breakdown' })).toBeVisible();
		await expect(page).toHaveURL(/bd=1/);
		await expect(page).toHaveURL(/hl=KDB-X/);

		await page.locator('td[data-cell]').nth(1).hover();
		await expect(page.getByRole('tooltip').filter({ hasText: 'Copy' })).toBeVisible();

		await expect(status(page)).toContainText('on 81 of 84 queries');
		await page.getByRole('checkbox', { name: 'Include Q1 in the comparison' }).uncheck();
		await expect(status(page)).toContainText('on 80 of 84 queries');
		await expect(page).toHaveURL(/skip=1/);

		await page.getByRole('button', { name: 'Hide query breakdown' }).click();
		await expect(page.getByRole('heading', { name: 'Query breakdown' })).toHaveCount(0);
	});

	test('the load time tab shows the memory and load charts', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('tab', { name: 'Load time statistics' }).click();
		await expect(page).toHaveURL(/tab=load/);
		await expect(page.getByRole('heading', { name: 'Max resident memory (GB)' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Data size in memory (GB)' })).toBeVisible();
		await expect(page.getByRole('heading', { name: /Total load time/ })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Load time table' })).toBeVisible();
		await expect(page.getByText('n/a on this tab').first()).toBeVisible();
		await page.keyboard.press('Tab');
		await page.getByRole('tab', { name: 'Load time statistics' }).focus();
		await page.keyboard.press('ArrowLeft');
		await expect(page.getByRole('tab', { name: 'Query statistics' })).toHaveAttribute('aria-selected', 'true');
	});

	test('theme toggle switches and is remembered', async ({ page }) => {
		await page.goto('/');
		const html = page.locator('html');
		const before = await html.getAttribute('data-theme');
		await page.getByRole('button', { name: /theme/ }).click();
		const after = await html.getAttribute('data-theme');
		expect(after).not.toBe(before);
		await page.reload();
		await expect(html).toHaveAttribute('data-theme', after!);
	});

	test('follows the operating system theme by default', async ({ browser }) => {
		const ctx = await browser.newContext({ colorScheme: 'dark' });
		const page = await ctx.newPage();
		await page.goto('/');
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await ctx.close();
	});

	test('copy link confirms', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		await page.goto('/?threads=16');
		await page.getByRole('button', { name: 'Copy link' }).click();
		await expect(page.getByRole('button', { name: 'Link copied' })).toBeVisible();
		expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\?threads=16$/);
	});

	test('the earlier hardware and thread scaling paths redirect to the main page', async ({ page }) => {
		for (const path of ['/pages/hardware/index.html', '/pages/threadscaling/index.html']) {
			await page.goto(path);
			await expect(page).toHaveURL(/localhost:\d+\/$/);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		}
	});

	test('shows an error with a retry when the data file cannot be loaded', async ({ page }) => {
		let fail = true;
		await page.route('**/data/full.json', (route) => (fail ? route.fulfill({ status: 500, body: 'no' }) : route.continue()));
		await page.goto('/');
		await expect(page.getByRole('heading', { name: 'The full data could not be loaded' })).toBeVisible();
		fail = false;
		await page.getByRole('button', { name: 'Retry' }).click();
		await expect(status(page)).toContainText('Comparing 5 solutions');
	});
});

test.describe('phone width', () => {
	test.use({ viewport: { width: 360, height: 780 } });

	for (const [name, path] of [
		['query statistics', '/'],
		['load time statistics', '/?tab=load'],
		['query breakdown', '/?bd=1']
	] as const) {
		test(`${name} does not scroll the page horizontally`, async ({ page }) => {
			await page.goto(path);
			await expect(status(page)).toContainText('Comparing');
			const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }));
			expect(sw).toBeLessThanOrEqual(iw);
		});
	}

	test('one filter panel at a time, as a bottom sheet', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: /^Setup/ }).click();
		await page.getByRole('button', { name: /^Queries/ }).click();
		await expect(page.locator('section.panel')).toHaveCount(1);
		const box = await page.locator('section.panel').boundingBox();
		expect(box!.y + box!.height).toBeGreaterThan(770);
	});
});
