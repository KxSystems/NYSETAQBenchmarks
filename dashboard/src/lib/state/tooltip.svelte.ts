/** One shared floating tooltip, driven by the `tip` action. */

export interface SpecEntry {
	key: string;
	value?: string;
	children?: SpecEntry[];
}

export interface TipContent {
	title?: string;
	lines?: string[];
	/** Grouped key/value lists (machine specification). */
	groups?: { heading: string; entries: SpecEntry[] }[];
}

export type TipInput = string | TipContent | null | undefined;

export const tooltip = $state<{ anchor: HTMLElement | SVGElement | null; content: TipContent | null }>({
	anchor: null,
	content: null
});

export const TOOLTIP_ID = 'shared-tooltip';

function normalise(c: TipInput): TipContent | null {
	if (!c) return null;
	return typeof c === 'string' ? { lines: [c] } : c;
}

export function showTip(anchor: HTMLElement | SVGElement, c: TipInput) {
	const content = normalise(c);
	if (!content) return;
	tooltip.anchor = anchor;
	tooltip.content = content;
	anchor.setAttribute('aria-describedby', TOOLTIP_ID);
}

export function hideTip(anchor?: HTMLElement | SVGElement) {
	if (anchor && tooltip.anchor !== anchor) return;
	tooltip.anchor?.removeAttribute('aria-describedby');
	tooltip.anchor = null;
	tooltip.content = null;
}

/** Svelte action: show `content` on hover, focus and touch. */
export function tip(node: HTMLElement | SVGElement, input: TipInput) {
	let current = input;
	const show = () => showTip(node, current);
	const hide = () => hideTip(node);
	const touch = (e: Event) => {
		if ((e as PointerEvent).pointerType !== 'touch') return;
		if (tooltip.anchor === node) hideTip(node);
		else showTip(node, current);
	};
	node.addEventListener('pointerenter', (e) => (e as PointerEvent).pointerType !== 'touch' && show());
	node.addEventListener('pointerleave', (e) => (e as PointerEvent).pointerType !== 'touch' && hide());
	node.addEventListener('focus', show);
	node.addEventListener('blur', hide);
	node.addEventListener('pointerdown', touch);
	return {
		update(next: TipInput) {
			current = next;
			if (tooltip.anchor === node) {
				const c = normalise(next);
				if (c) tooltip.content = c;
				else hideTip(node);
			}
		},
		destroy() {
			hide();
		}
	};
}
