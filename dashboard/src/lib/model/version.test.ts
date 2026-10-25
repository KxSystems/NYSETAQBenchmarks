import { describe, expect, it } from 'vitest';
import { mkDataset } from './fixtures';
import { effectiveVersion, forVersion, versionOptions } from './version';

function versioned() {
	const ds = mkDataset();
	ds.runs[0]!.benchmark_version = '1.0';
	ds.runs[1]!.benchmark_version = '1.9';
	ds.runs[2]!.benchmark_version = '1.10';
	return ds;
}

describe('benchmark version', () => {
	it('lists the versions in numeric order', () => {
		expect(versionOptions(versioned())).toEqual(['1.0', '1.9', '1.10']);
	});

	it('defaults to the latest and ignores unknown choices', () => {
		const ds = versioned();
		expect(effectiveVersion(ds, null)).toBe('1.10');
		expect(effectiveVersion(ds, '1.9')).toBe('1.9');
		expect(effectiveVersion(ds, '7.0')).toBe('1.10');
	});

	it('keeps only the runs of the chosen version', () => {
		const ds = versioned();
		expect(forVersion(ds, '1.9').runs).toHaveLength(1);
		expect(forVersion(ds, '1.9').runs[0]).toBe(ds.runs[1]);
	});

	it('leaves a file without versioned runs alone', () => {
		const ds = mkDataset();
		expect(versionOptions(ds)).toEqual([]);
		expect(effectiveVersion(ds, '1.0')).toBeNull();
		expect(forVersion(ds, null)).toBe(ds);
	});
});
