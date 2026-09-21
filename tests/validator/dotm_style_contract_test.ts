import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

import { getStoStylePresetDisplayNames } from '@/shared/config';
import {
	dotmStyleSemanticsSha256,
	readDotmStyles,
	sha256File,
} from '@/shared/lib/dotm-style-contract';

type ClassificationKind = 'mapped' | 'adapted' | 'deferred' | 'ignored';

interface ContractStyle {
	id: string;
	name: string;
	type: string;
}

interface DotmStyleContract {
	fixture: string;
	sha256: string;
	semanticSha256: string;
	containsVba: boolean;
	upstreamEvidence: {
		acquisitionClass: string;
		originalFilename: string;
		sha256: string;
		semanticSha256: string;
		relationship: string;
	};
	styles: ContractStyle[];
	classifications: Array<{
		kind: ClassificationKind;
		rationale: string;
		styleIds: string[];
	}>;
	mappedStyles: Array<{ styleId: string; generatorStyleId: string }>;
}

const fixtureDirectory = path.join(
	process.cwd(),
	'tests/fixtures/validator/etalon',
);
const contractPath = path.join(fixtureDirectory, 'dotm-style-contract.json');
const contract = JSON.parse(
	fs.readFileSync(contractPath, 'utf8'),
) as DotmStyleContract;

function sorted(values: string[]): string[] {
	return [...values].sort((left, right) => left.localeCompare(right));
}

function assertUnique(values: string[], label: string): void {
	assert.equal(
		new Set(values).size,
		values.length,
		`${label} must be unique`,
	);
}

function assertInventory(): void {
	const styleIds = contract.styles.map(style => style.id);
	assert.equal(
		contract.styles.length,
		79,
		'DOTM inventory must contain 79 styles',
	);
	assertUnique(styleIds, 'Contract style IDs');

	const classifiedIds = contract.classifications.flatMap(
		classification => classification.styleIds,
	);
	assert.equal(
		contract.classifications.length,
		4,
		'All classifications are declared',
	);
	assert.deepEqual(
		sorted(contract.classifications.map(item => item.kind)),
		sorted(['mapped', 'adapted', 'deferred', 'ignored']),
	);
	for (const classification of contract.classifications) {
		assert.notEqual(classification.rationale.trim(), '');
	}
	assertUnique(classifiedIds, 'Classified style IDs');
	assert.deepEqual(sorted(classifiedIds), sorted(styleIds));

	const mappedIds = contract.classifications.find(
		item => item.kind === 'mapped',
	)?.styleIds;
	assert.ok(mappedIds, 'Mapped styles classification must exist');
	assert.deepEqual(
		sorted(contract.mappedStyles.map(item => item.styleId)),
		sorted(mappedIds),
	);
}

function assertMappedDisplayNames(): void {
	const contractNames = new Map(
		contract.styles.map(style => [style.id, style.name]),
	);
	const generatorNames = getStoStylePresetDisplayNames(
		'samara-template-2022',
	);
	for (const { styleId, generatorStyleId } of contract.mappedStyles) {
		assert.equal(
			generatorNames[generatorStyleId],
			contractNames.get(styleId),
			`Mapped DOTM style ${styleId} must retain its display name`,
		);
	}
}

function assertFixture(): void {
	const fixturePath = path.join(fixtureDirectory, contract.fixture);
	assert.equal(sha256File(fixturePath), contract.sha256);
	const archiveEntries = new AdmZip(fixturePath).getEntries();
	const containsVba = archiveEntries.some(entry =>
		entry.entryName.toLowerCase().endsWith('vbaproject.bin'),
	);
	assert.equal(containsVba, contract.containsVba);

	const actualStyles = readDotmStyles(fixturePath);
	assert.equal(actualStyles.length, contract.styles.length);
	const actualById = new Map(actualStyles.map(style => [style.id, style]));
	for (const expected of contract.styles) {
		const actual = actualById.get(expected.id);
		assert.ok(actual, `DOTM style ${expected.id} must exist`);
		assert.equal(actual.type, expected.type, `${expected.id} type`);
		assert.equal(actual.name, expected.name, `${expected.id} display name`);
	}
	assert.equal(
		dotmStyleSemanticsSha256(actualStyles),
		contract.semanticSha256,
	);
	assert.match(contract.upstreamEvidence.sha256, /^[a-f0-9]{64}$/);
	assert.equal(
		contract.upstreamEvidence.semanticSha256,
		contract.semanticSha256,
		'Pinned external audit evidence must record the same style semantics as the canonical fixture',
	);
	assert.notEqual(contract.upstreamEvidence.originalFilename.trim(), '');
	assert.notEqual(contract.upstreamEvidence.acquisitionClass.trim(), '');
	assert.equal(
		contract.upstreamEvidence.relationship,
		'style-semantics-equivalent, package-bytes-different',
	);
}

function main(): void {
	assertInventory();
	assertFixture();
	assertMappedDisplayNames();
	console.log('DOTM style contract test passed.');
}

main();
