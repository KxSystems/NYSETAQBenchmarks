import { pushState, replaceState } from '$app/navigation';
import { getContext, setContext, tick } from 'svelte';
import { loadDataset } from '../data/load';
import type { Dataset } from '../data/types';
import { effectiveExcludeTags } from '../model/queries';
import { analyse, type Analysis } from '../model/analysis';
import { resolve, selectedSolutions, type Resolved } from '../model/series';
import { canonicalView } from './canonical';
import { parseView, serializeView } from './url';
import { DEFAULT_SOLUTIONS, defaultView, type View } from './view';

export type PanelId = 'solutions' | 'setup' | 'queries';

export class App {
	view = $state<View>(defaultView());
	status = $state<'loading' | 'ready' | 'error'>('loading');
	ds = $state.raw<Dataset | null>(null);
	error = $state<string | null>(null);
	openPanels = $state<PanelId[]>([]);
	hovered = $state<string | null>(null);
	linkCopied = $state(false);
	isPhone = $state(false);

	/** The resolved comparison, only for the data file that matches the selected size. */
	resolved = $derived<Resolved | null>(
		this.ds && this.ds.size === this.view.size ? resolve(this.ds, this.view) : null
	);

	analysis = $derived<Analysis | null>(this.resolved ? analyse(this.resolved, this.view.timing) : null);

	#mounted = false;
	#synced: View = defaultView();
	#loadToken = 0;
	#copyTimer: ReturnType<typeof setTimeout> | undefined;

	/** Start in the browser: read the URL, load data, and follow back/forward. */
	init(): () => void {
		this.view = parseView(location.search);
		this.#synced = structuredClone($state.snapshot(this.view));
		this.#mounted = true;
		void this.#load(this.view.size, true);

		const onPop = () => {
			const next = parseView(location.search);
			this.#synced = structuredClone(next);
			this.view = this.ds && this.ds.size === next.size ? canonicalView(this.ds, next) : next;
			if (!this.ds || this.ds.size !== next.size) void this.#load(next.size, true);
		};
		window.addEventListener('popstate', onPop);

		const mq = matchMedia('(max-width: 639.98px)');
		const onMq = () => (this.isPhone = mq.matches);
		onMq();
		mq.addEventListener('change', onMq);
		return () => {
			window.removeEventListener('popstate', onPop);
			mq.removeEventListener('change', onMq);
			this.#mounted = false;
		};
	}

	async #load(size: string, normalise: boolean) {
		const token = ++this.#loadToken;
		this.status = 'loading';
		this.error = null;
		try {
			const ds = await loadDataset(size);
			if (token !== this.#loadToken) return;
			this.ds = ds;
			if (normalise) this.view = canonicalView(ds, this.view);
			this.status = 'ready';
		} catch (e) {
			if (token !== this.#loadToken) return;
			this.error = e instanceof Error ? e.message : String(e);
			this.status = 'error';
		}
	}

	retry() {
		void this.#load(this.view.size, true);
	}

	/** Change choices. Choices equal to defaults are stored as null. */
	set(patch: Partial<View>) {
		const next = { ...$state.snapshot(this.view), ...patch };
		const sizeChanged = next.size !== this.view.size;
		if (sizeChanged) {
			this.status = 'loading';
			void this.#load(next.size, true);
		}
		this.view = this.ds && !sizeChanged ? canonicalView(this.ds, next) : next;
	}

	reset() {
		this.set(defaultView());
	}

	togglePanel(id: PanelId) {
		if (this.openPanels.includes(id)) {
			this.openPanels = this.openPanels.filter((p) => p !== id);
		} else {
			this.openPanels = this.isPhone ? [id] : [...this.openPanels, id];
		}
	}
	closePanel(id: PanelId) {
		this.openPanels = this.openPanels.filter((p) => p !== id);
	}

	/** Toggle one value in a multi-choice list, given the full current list. */
	toggleIn(current: string[], value: string): string[] {
		return current.includes(value) ? current.filter((x) => x !== value) : [...current, value];
	}

	/** Open the query breakdown, optionally highlighting a column and filtering the rows, and scroll to it. */
	async openBreakdown(highlight: string | null, rows: View['rows'] = null) {
		this.set({ breakdownOpen: true, highlight, rows });
		await tick();
		const el = document.getElementById('breakdown');
		const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
		el?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
	}

	/** Write the view into the URL; called from an effect when the view changes. */
	syncUrl() {
		const snap = $state.snapshot(this.view);
		const search = serializeView(snap);
		if (!this.#mounted || this.status === 'loading') return;
		if (search === location.search) {
			this.#synced = structuredClone(snap);
			return;
		}
		const prev = this.#synced;
		const push = prev.size !== snap.size || prev.tab !== snap.tab || prev.machine !== snap.machine;
		this.#synced = structuredClone(snap);
		const url = location.pathname + search;
		try {
			if (push) pushState(url, {});
			else replaceState(url, {});
		} catch {
			(push ? history.pushState : history.replaceState).call(history, history.state, '', url);
		}
	}

	async copyLink() {
		const url = location.origin + location.pathname + serializeView($state.snapshot(this.view));
		try {
			await navigator.clipboard.writeText(url);
		} catch {
			const ta = document.createElement('textarea');
			ta.value = url;
			document.body.appendChild(ta);
			ta.select();
			document.execCommand('copy');
			ta.remove();
		}
		this.linkCopied = true;
		clearTimeout(this.#copyTimer);
		this.#copyTimer = setTimeout(() => (this.linkCopied = false), 2000);
	}

	// ---- helpers for the filter UI ----
	get solutionsSelected(): string[] {
		return this.ds ? selectedSolutions(this.ds, this.view) : DEFAULT_SOLUTIONS;
	}
	get excludeTagsSelected(): string[] {
		return effectiveExcludeTags(this.view);
	}
}

const KEY = Symbol('app');
export function provideApp(app: App) {
	setContext(KEY, app);
}
export function useApp(): App {
	return getContext<App>(KEY);
}
