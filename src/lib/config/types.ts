export interface ResourceLink {
	label: string;
	description: string;
	href: string;
	icon: 'book' | 'play' | 'plus' | 'hardware' | 'threads';
	external: boolean;
}
