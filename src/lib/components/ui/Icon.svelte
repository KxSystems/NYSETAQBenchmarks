<script lang="ts">
	type Props = { name: keyof typeof paths; size?: number };
	let { name, size = 18 }: Props = $props();

	// Simple 24×24 stroke icons.
	const paths = {
		book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 19V5M9 7h6M9 11h6',
		play: 'M6 4l14 8-14 8z',
		plus: 'M12 5v14M5 12h14',
		external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
		sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
		moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
		chevron: 'M6 9l6 6 6-6',
		close: 'M6 6l12 12M18 6L6 18',
		copy: 'M9 9h10v10H9zM5 15V5h10',
		check: 'M5 12l5 5 9-10',
		info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
		link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
		reset: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
		chip: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
		fail: 'M6 6l12 12M18 6L6 18',
		hardware: 'M4 6h16v10H4zM8 20h8M12 16v4',
		threads: 'M4 6h16M4 12h10M4 18h16',
		solutions: 'M5 20V10M12 20V4M19 20v-7'
	} as const;
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<path d={paths[name]} />
</svg>
