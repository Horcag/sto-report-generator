import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runBibliographyCommand } from '@/app/bibliography-command';
import { lookupDataset } from '@/app/bibliography-dataset-lookup';

const entry = {
	key: 'data',
	type: 'online',
	fields: {
		type: 'Dataset',
		title: 'Public synthetic observations',
		version: '3.1.0',
	},
};
const record = (
	doi: string,
	version = '3.1.0',
	resourceTypeGeneral = 'Dataset',
) => ({
	attributes: {
		doi,
		titles: [{ title: entry.fields.title }],
		version,
		publisher: 'Public Repository',
		creators: [{ name: 'Example, Jane' }],
		url: `https://repository.example/${doi}`,
		types: { resourceTypeGeneral },
	},
});
const response =
	(data: unknown[], total = data.length): typeof fetch =>
	async () =>
		new Response(JSON.stringify({ data, meta: { total } }), {
			status: 200,
		});
async function main() {
	let requests = 0;
	const success = await lookupDataset(entry, async (url, options) => {
		requests++;
		const parsed = new URL(String(url));
		assert.equal(parsed.origin, 'https://api.datacite.org');
		assert.equal(parsed.searchParams.get('resource-type-id'), 'dataset');
		assert.equal(parsed.searchParams.get('page[size]'), '10');
		assert.equal(
			parsed.searchParams.get('query'),
			'titles.title:"Public synthetic observations" AND version:"3.1.0"',
		);
		assert.ok(options?.signal);
		return response([record('10.1234/data')])(url, options);
	});
	assert.equal(requests, 1);
	assert.equal(success.status, 'candidate');
	assert.deepEqual(success.candidates[0].creators, ['Example, Jane']);
	assert.equal(success.candidates[0].publisher, 'Public Repository');
	assert.equal(
		(
			await lookupDataset(
				entry,
				response([record('10.1234/a'), record('10.1234/b')]),
			)
		).status,
		'ambiguous',
	);
	assert.equal(
		(await lookupDataset(entry, response([record('10.1234/a')], 20)))
			.status,
		'ambiguous',
	);
	assert.equal((await lookupDataset(entry, response([]))).status, 'no-match');
	assert.equal(
		(await lookupDataset(entry, response([record('10.1234/a', '1.0.0')])))
			.status,
		'version-mismatch',
	);
	const collection = {
		attributes: {
			...record('10.1234/collection').attributes,
			relatedIdentifiers: [
				{
					relationType: 'HasVersion',
					relatedIdentifier: '10.1234/release',
					relatedIdentifierType: 'DOI',
				},
			],
		},
	};
	const release = {
		attributes: {
			...record('10.1234/release').attributes,
			relatedIdentifiers: [
				{
					relationType: 'IsVersionOf',
					relatedIdentifier: '10.1234/collection',
					relatedIdentifierType: 'DOI',
				},
				{
					relationType: 'Describes',
					relatedIdentifier: '10.1234/paper',
					relatedIdentifierType: 'DOI',
				},
			],
		},
	};
	const related = await lookupDataset(entry, response([collection, release]));
	assert.equal(
		related.status,
		'ambiguous',
		'Relations distinguish candidates without verifying the source',
	);
	assert.equal(related.candidates[0].versionRole, 'has-versions');
	assert.equal(related.candidates[1].versionRole, 'version-of');
	assert.deepEqual(related.candidates[1].relatedIdentifiers, [
		{
			relationType: 'IsVersionOf',
			relatedIdentifier: '10.1234/collection',
			relatedIdentifierType: 'DOI',
		},
	]);
	assert.equal(success.candidates[0].versionRole, 'unspecified');
	const paper = await lookupDataset(
		entry,
		response([record('10.1234/paper', '3.1.0', 'JournalArticle')]),
	);
	assert.equal(paper.status, 'no-match');
	assert.equal(paper.candidates[0].status, 'resource-type-mismatch');
	assert.equal(
		(
			await lookupDataset(
				entry,
				async () => new Response('', { status: 503 }),
			)
		).status,
		'provider-error',
	);
	assert.equal(
		(
			await lookupDataset(entry, async () => {
				throw new Error('Connection failed');
			})
		).status,
		'provider-error',
	);
	assert.equal(
		(
			await lookupDataset(entry, async () => {
				throw new DOMException('Deadline exceeded', 'TimeoutError');
			})
		).status,
		'timeout',
	);
	assert.equal(
		(await lookupDataset(entry, async () => new Response('{invalid')))
			.status,
		'provider-error',
	);
	assert.equal(
		(await lookupDataset(entry, async () => new Response('{"data":null}')))
			.status,
		'provider-error',
	);
	const forbidden: typeof fetch = async () => {
		throw new Error('Must not request metadata');
	};
	await assert.rejects(
		lookupDataset(
			{ ...entry, fields: { ...entry.fields, type: 'article' } },
			forbidden,
		),
		/explicitly typed/,
	);
	await assert.rejects(
		lookupDataset(
			{ ...entry, fields: { ...entry.fields, title: '' } },
			forbidden,
		),
		/public title/,
	);
	await assert.rejects(
		lookupDataset(
			{ ...entry, fields: { ...entry.fields, version: '' } },
			forbidden,
		),
		/explicit version/,
	);

	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sto-dataset-lookup-'));
	const originalFetch = globalThis.fetch;
	const originalLog = console.log;
	const originalExit = process.exitCode;
	try {
		fs.writeFileSync(
			path.join(root, '00_metadata.md'),
			'---\nbibliography: references.bib\n---\n',
		);
		fs.writeFileSync(
			path.join(root, '03_intro.md'),
			'Sources [@data; @page].\n',
		);
		const bibPath = path.join(root, 'references.bib');
		const bib =
			'@online{data,author={Example, Jane},title={Public synthetic observations},type={Dataset},version={3.1.0},url={https://repository.example/data},urldate={2020-01-01},langid={english}}\n@online{page,author={Example, Jane},title={A public documentation page},url={https://docs.example/page},urldate={2020-01-01},langid={english}}';
		fs.writeFileSync(bibPath, bib);
		let networkCalls = 0;
		globalThis.fetch = async (...args) => {
			networkCalls++;
			return response([record('10.1234/data')])(...args);
		};
		const logs: string[] = [];
		console.log = value => logs.push(String(value));
		const command = (value?: string | boolean) =>
			runBibliographyCommand({
				positionals: ['bibliography', root],
				options: new Map<string, string | boolean>([
					['json', true],
					...(value === undefined
						? []
						: [
								['lookup-dataset', value] as [
									string,
									string | boolean,
								],
							]),
				]),
			});
		for (const key of ['', true, 'missing', 'page'])
			await assert.rejects(command(key), /lookup-dataset/);
		assert.equal(
			networkCalls,
			0,
			'Invalid keys/types never send public metadata',
		);
		await command();
		assert.equal(
			networkCalls,
			0,
			'Offline default must not query DataCite',
		);
		await command('data');
		assert.equal(networkCalls, 1);
		assert.equal(
			JSON.parse(logs.at(-1)!).datasetLookup.status,
			'candidate',
		);
		assert.equal(fs.readFileSync(bibPath, 'utf8'), bib);
		assert.equal(
			fs.existsSync(path.join(root, 'bibliography-evidence.json')),
			false,
		);
	} finally {
		globalThis.fetch = originalFetch;
		console.log = originalLog;
		process.exitCode = originalExit;
		fs.rmSync(root, { recursive: true, force: true });
	}
	console.log(
		'PASS dataset lookup: bounded requests; candidates, ambiguity, no-match, versions, companion-paper exclusion, HTTP/transport/timeout/malformed responses, validation, offline CLI default and no source mutation.',
	);
}
main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
