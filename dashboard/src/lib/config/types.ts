import type { Component } from 'svelte';
import type { PageId, PageLogic } from '../model/pages';

export interface ResourceLink {
	label: string;
	description: string;
	href: string;
	icon: 'book' | 'play' | 'plus' | 'hardware' | 'threads' | 'solutions';
	external: boolean;
	/** The page being viewed: highlighted, not clickable, `aria-current="page"`. */
	current?: boolean;
}

/**
 * One page of the site: its logic (what the series are) plus its text, links and the filter
 * panels that differ between pages.
 */
export interface PageConfig {
	id: PageId;
	logic: PageLogic;
	title: string;
	/** Title of the browser tab and the meta description. */
	description: string;
	intro: Component;
	links: ResourceLink[];
	SolutionsPanel: Component;
	SetupPanel: Component;
}
