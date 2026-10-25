import { describe, expect, it } from 'vitest';
import { bandOf } from './bands';
import {
	compareNames,
	formatGB,
	formatRatio,
	formatRatioCompact,
	formatRatioSpoken,
	formatTime,
	instrumentRefinementLabel,
	kbToGB,
	mbToGB,
	sortColumnsLabel,
	threadsLabel
} from './format';

describe('formatTime', () => {
	it('uses seconds with three decimals', () => {
		expect(formatTime(276_000_000)).toBe('0.276s');
		expect(formatTime(419_407_149_349)).toBe('419.407s');
	});
	it('uses milliseconds below 1 ms', () => {
		expect(formatTime(420_000)).toBe('0.42ms');
	});
});

describe('formatRatio', () => {
	it('phrases slower, faster and equal', () => {
		expect(formatRatio(2.15)).toBe('2.15× slower');
		expect(formatRatio(0.294)).toBe('3.40× faster');
		expect(formatRatio(1)).toBe('×1.00');
		expect(formatRatio(1.004)).toBe('×1.00');
	});
	it('has compact and spoken forms', () => {
		expect(formatRatioCompact(2.151)).toBe('×2.15');
		expect(formatRatioCompact(0.294)).toBe('×0.29');
		expect(formatRatioSpoken(1.32, 'KDB-X')).toBe('1.32 times slower than KDB-X');
		expect(formatRatioSpoken(0.5, 'KDB-X')).toBe('2.00 times faster than KDB-X');
	});
});

describe('units and labels', () => {
	it('converts memory and data size to GB', () => {
		expect(formatGB(kbToGB(482067440))).toBe('459.7');
		expect(formatGB(mbToGB(323984.13))).toBe('316.4');
	});
	it('labels sort columns and instrument refinements', () => {
		expect(sortColumnsLabel(['sym', 'time'])).toBe('Sym, Time');
		expect(instrumentRefinementLabel('1000infreq')).toBe('1000 infreq');
		expect(instrumentRefinementLabel('frequent')).toBe('frequent');
	});
	it('pluralises threads', () => {
		expect(threadsLabel('1')).toBe('1 thread');
		expect(threadsLabel('4')).toBe('4 threads');
		expect(threadsLabel(null)).toBe('? threads');
	});
	it('sorts names alphabetically, ignoring case, numbers numerically', () => {
		const names = ['pykx', 'chDB (Memory)', 'KDB-X SQL', 'KDB-X', 'Pandas', 'Engine 10', 'Engine 9'];
		expect(names.sort(compareNames)).toEqual([
			'chDB (Memory)',
			'Engine 9',
			'Engine 10',
			'KDB-X',
			'KDB-X SQL',
			'Pandas',
			'pykx'
		]);
	});
});

describe('bandOf', () => {
	it('uses the spec boundaries', () => {
		expect(bandOf(0.49)).toBe('much-faster');
		expect(bandOf(0.5)).toBe('faster');
		expect(bandOf(0.89)).toBe('faster');
		expect(bandOf(0.9)).toBe('similar');
		expect(bandOf(1.1)).toBe('similar');
		expect(bandOf(1.11)).toBe('slower');
		expect(bandOf(2)).toBe('slower');
		expect(bandOf(2.01)).toBe('much-slower');
	});
});
