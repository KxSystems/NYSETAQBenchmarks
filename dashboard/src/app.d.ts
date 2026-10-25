declare global {
	/** Data sizes found in static/data/ at startup, injected by vite.config.ts. */
	const __DATA_SIZES__: string[];

	namespace App {}
	interface Window {
		OneTrust?: { ToggleInfoDisplay?: () => void };
	}
}

export {};
