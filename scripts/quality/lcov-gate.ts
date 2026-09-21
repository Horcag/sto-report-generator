import { readFileSync } from 'node:fs';

export type CoverageMetric = 'lines' | 'functions' | 'branches';

export type CoverageSummary = Record<
	CoverageMetric,
	{ covered: number; found: number }
>;

export type CoverageMinimums = Record<CoverageMetric, number>;

const metricFields: Record<CoverageMetric, readonly [string, string]> = {
	lines: ['LH', 'LF'],
	functions: ['FNH', 'FNF'],
	branches: ['BRH', 'BRF'],
};

function parseCount(value: string, field: string): number {
	const count = Number(value);
	if (!Number.isSafeInteger(count) || count < 0) {
		throw new Error(`Invalid ${field} count in LCOV report: ${value}`);
	}
	return count;
}

export function parseLcov(lcov: string): CoverageSummary {
	const summary: CoverageSummary = {
		lines: { covered: 0, found: 0 },
		functions: { covered: 0, found: 0 },
		branches: { covered: 0, found: 0 },
	};
	let fileCount = 0;

	for (const line of lcov.split(/\r?\n/u)) {
		if (line.startsWith('SF:')) {
			fileCount += 1;
		}
		for (const [metric, [coveredField, foundField]] of Object.entries(
			metricFields,
		) as [CoverageMetric, readonly [string, string]][]) {
			if (line.startsWith(`${coveredField}:`)) {
				summary[metric].covered += parseCount(
					line.slice(coveredField.length + 1),
					coveredField,
				);
			}
			if (line.startsWith(`${foundField}:`)) {
				summary[metric].found += parseCount(
					line.slice(foundField.length + 1),
					foundField,
				);
			}
		}
	}

	if (fileCount === 0) {
		throw new Error('LCOV report contains no source files.');
	}
	for (const [metric, value] of Object.entries(summary) as [
		CoverageMetric,
		CoverageSummary[CoverageMetric],
	][]) {
		if (value.found === 0) {
			throw new Error(`LCOV report contains no ${metric} coverage data.`);
		}
		if (value.covered > value.found) {
			throw new Error(`LCOV ${metric} coverage exceeds its total.`);
		}
	}

	return summary;
}

export function percentage({
	covered,
	found,
}: CoverageSummary[CoverageMetric]): number {
	return (covered / found) * 100;
}

export function coverageFailures(
	summary: CoverageSummary,
	minimums: CoverageMinimums,
): string[] {
	return (Object.keys(metricFields) as CoverageMetric[]).flatMap(metric => {
		const actual = percentage(summary[metric]);
		const minimum = minimums[metric];
		if (!Number.isFinite(minimum) || minimum < 0 || minimum > 100) {
			throw new Error(`Invalid ${metric} coverage minimum: ${minimum}`);
		}
		return actual + Number.EPSILON < minimum
			? [
					`${metric}: ${actual.toFixed(2)}% is below ${minimum.toFixed(2)}%`,
				]
			: [];
	});
}

export function readCoverageMinimums(
	path: string,
	platform = process.platform,
): CoverageMinimums {
	const config = JSON.parse(readFileSync(path, 'utf8')) as {
		minimums?: CoverageMinimums;
		platformMinimums?: Record<string, Partial<CoverageMinimums>>;
	};
	if (!config.minimums) {
		throw new Error(`Coverage baseline has no minimums: ${path}`);
	}
	return { ...config.minimums, ...config.platformMinimums?.[platform] };
}
