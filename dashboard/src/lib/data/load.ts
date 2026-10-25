import type { Dataset } from './types';

export const SUPPORTED_SCHEMA_VERSION = 1;

/**
 * Data sizes that have a file under /data/, in the order shown in the filter. The list is
 * read from static/data/*.json when Vite starts (see vite.config.ts), so a newly generated
 * file shows up after restarting `npm run dev`.
 */
export const SIZES: readonly string[] = __DATA_SIZES__;

/** `preferred` when it has a data file, otherwise the first size that does. */
export function availableSize(preferred: string): string {
	return SIZES.includes(preferred) ? preferred : (SIZES[0] ?? preferred);
}

export const DEFAULT_SIZE = availableSize('full');

export class DataError extends Error {}

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Light structural check; throws DataError when the file cannot be used. */
export function validateDataset(raw: unknown, size: string): Dataset {
	if (!isObject(raw)) throw new DataError(`The ${size} data file is not a JSON object.`);
	if (raw.schema_version !== SUPPORTED_SCHEMA_VERSION) {
		throw new DataError(
			`The ${size} data file has schema version ${String(raw.schema_version)}; this site understands version ${SUPPORTED_SCHEMA_VERSION}.`
		);
	}
	if (
		!Array.isArray(raw.queries) ||
		!Array.isArray(raw.runs) ||
		!Array.isArray(raw.load_phases) ||
		!isObject(raw.solutions) ||
		!isObject(raw.machines) ||
		!isObject(raw.tags)
	) {
		throw new DataError(`The ${size} data file is missing required sections.`);
	}
	return raw as unknown as Dataset;
}

const cache = new Map<string, Promise<Dataset>>();

/** Fetch and validate data/<size>.json. Successful loads are cached; failures are not. */
export function loadDataset(size: string, fetchFn: typeof fetch = fetch): Promise<Dataset> {
	let p = cache.get(size);
	if (!p) {
		p = (async () => {
			let res: Response;
			try {
				res = await fetchFn(`/data/${size}.json`);
			} catch {
				throw new DataError(`Could not fetch the ${size} data file.`);
			}
			if (!res.ok) throw new DataError(`Could not fetch the ${size} data file (HTTP ${res.status}).`);
			let json: unknown;
			try {
				json = await res.json();
			} catch {
				throw new DataError(`The ${size} data file is not valid JSON.`);
			}
			return validateDataset(json, size);
		})();
		cache.set(size, p);
		p.catch(() => cache.delete(size));
	}
	return p;
}
