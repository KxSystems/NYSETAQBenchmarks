import { pushState, replaceState } from '$app/navigation';
import { getContext, setContext, tick } from 'svelte';
import { loadDataset } from '../data/load';
import type { Dataset } from '../data/types';
import type { PageConfig } from '../config/types';
import { effectiveExcludeTags } from '../model/queries';
import { effectiveVersion, forVersion, versionOptions } from '../model/version';
import { analyse, type Analysis } from '../model/analysis';
import { selectedSolutions, type Resolved } from '../model/series';
import { parseView, serializeView } from './url';
import { DEFAULT_SOLUTIONS, type PanelId, type View } from './view';

export type { PanelId };

export class App {
	/** The page this state belongs to: its logic and its text. */
	readonly page: PageConfig;
	readonly logic: PageConfig['logic'];
	view = $state<View>() as View;
	status = $state<'loading' | 'ready' | 'error'>('loading');
	/** The data file as loaded: runs of every benchmark version. */
	rawDs = $state.raw<Dataset | null>(null);
	/** The file narrowed to the selected benchmark version; everything but the version filter reads this. */
	ds = $derived.by<Dataset | null>(() =>
		this.rawDs ? forVersion(this.rawDs, effectiveVersion(this.rawDs, this.view.version)) : null
	);
	error = $state<string | null>(null);
	openPanels = $state<PanelId[]>([]);
	hovered = $state<string | null>(null);
	linkCopied = $state(false);
	isPhone = $state(false);

	/** The resolved comparison, only for the data file that matches the selected size. */
	resolved = $derived.by<Resolved | null>(() =>
		this.ds && this.ds.size === this.view.size ? this.logic.resolve(this.ds, this.view) : null
	);

	analysis = $derived.by<Analysis | null>(() =>
		this.resolved ? analyse(this.resolved, this.view.timing) : null
	);

	/** Display names of every series id the page can show (labels differ from ids for thread counts). */
	labels = $derived.by(() => new Map((this.resolved?.baselineOptions ?? []).map((o) => [o.id, o.label])));

	#mounted = false;
	#synced: View;
	#loadToken = 0;
	#copyTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(page: PageConfig) {
		this.page = page;
		this.logic = page.logic;
		this.view = page.logic.defaultView();
		this.#synced = structuredClone($state.snapshot(this.view));
	}

	/** Start in the browser: read the URL, load data, and follow back/forward. */
	init(): () => void {
		this.view = parseView(location.search, this.logic.defaultSize);
		this.#synced = structuredClone($state.snapshot(this.view));
		this.#mounted = true;
		void this.#load(this.view.size, true);

		const onPop = () => {
			const next = parseView(location.search, this.logic.defaultSize);
			this.#synced = structuredClone(next);
			this.view = this.rawDs && this.rawDs.size === next.size ? this.#canonical(this.rawDs, next) : next;
			if (!this.rawDs || this.rawDs.size !== next.size) void this.#load(next.size, true);
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

	/** Canonical view for the file: the version first (null when it is the latest), the rest within that version's runs. */
	#canonical(raw: Dataset, view: View): View {
		const version = effectiveVersion(raw, view.version);
		const canon = this.logic.canonical(forVersion(raw, version), view);
		return { ...canon, version: view.version === version && version !== versionOptions(raw).at(-1) ? version : null };
	}

	async #load(size: string, normalise: boolean) {
		const token = ++this.#loadToken;
		this.status = 'loading';
		this.error = null;
		try {
			const ds = await loadDataset(size);
			if (token !== this.#loadToken) return;
			this.rawDs = ds;
			if (normalise) this.view = this.#canonical(ds, this.view);
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
		this.view = this.rawDs && !sizeChanged ? this.#canonical(this.rawDs, next) : next;
	}

	reset() {
		this.set(this.logic.defaultView());
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
		const search = serializeView(snap, this.logic.defaultSize);
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
		const url = location.origin + location.pathname + serializeView($state.snapshot(this.view), this.logic.defaultSize);
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

	/** The name to show for a series id. */
	label(id: string): string {
		return this.labels.get(id) ?? id;
	}

	/** Remove one series from the comparison (the × on a chart row). */
	removeSeries(id: string) {
		if (!this.ds) return;
		const patch = this.logic.removeSeries(this.ds, $state.snapshot(this.view), id);
		if (patch) this.set(patch);
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
