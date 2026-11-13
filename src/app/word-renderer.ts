import fs from 'node:fs';
import path from 'node:path';

import { StoStylePreset } from '@/shared/config';

import { detectWordAcceptanceHost, runWordAcceptance } from './word-acceptance';

export interface WordRenderResult {
	manifest: string;
	pdf?: string;
}

/** Hold destination locks until a verified DOCX/PDF/manifest set is published. */
export function createWordRenderJob(options: {
	outputDocx: string;
	outputPdf?: string;
	exportPdf: boolean;
	sourceDir: string;
	stylePreset: StoStylePreset;
}) {
	detectWordAcceptanceHost();
	const outputDocx = path.resolve(options.outputDocx);
	const stem = outputDocx.replace(/\.docx$/i, '');
	const manifestPath = `${stem}.acceptance.json`;
	const pdfPath = options.exportPdf
		? (options.outputPdf ?? `${stem}.pdf`)
		: undefined;
	const destinations = [
		outputDocx,
		manifestPath,
		...(pdfPath ? [pdfPath] : []),
	];
	if (
		new Set(destinations.map(destination => destination.toLowerCase()))
			.size !== destinations.length
	) {
		throw new Error('Word DOCX, PDF, and manifest paths must be distinct.');
	}
	const locks: string[] = [];
	let directory: string | undefined;
	try {
		fs.mkdirSync(path.dirname(outputDocx), { recursive: true });
		for (const destination of [...destinations].sort()) {
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			if (
				fs.statSync(path.dirname(destination)).dev !==
				fs.statSync(path.dirname(outputDocx)).dev
			) {
				throw new Error(
					'Word outputs must be on the same filesystem for atomic publication.',
				);
			}
			if (
				fs.existsSync(destination) &&
				!fs.lstatSync(destination).isFile()
			) {
				throw new Error(
					'Word output destinations must be regular files, not directories or links.',
				);
			}
			const lock = `${destination}.word.lock`;
			const fd = fs.openSync(lock, 'wx');
			locks.push(lock);
			try {
				fs.writeFileSync(fd, JSON.stringify({ pid: process.pid }));
			} finally {
				fs.closeSync(fd);
			}
		}
		directory = fs.mkdtempSync(
			path.join(path.dirname(outputDocx), '.sto-word-render-'),
		);
	} catch (error) {
		for (const lock of locks) fs.unlinkSync(lock);
		throw error;
	}
	const staging = directory;
	const inputDocx = path.join(staging, 'input.docx');
	const acceptedDocx = path.join(staging, 'accepted.docx');
	const pdf = path.join(staging, 'accepted.pdf');
	const manifest = path.join(staging, 'acceptance.json');
	let cleanupSafe = true;
	return {
		inputDocx,
		acceptedDocx,
		render() {
			cleanupSafe = false;
			try {
				runWordAcceptance({
					inputDocx,
					acceptedDocx,
					pdf,
					manifest,
					stylePreset: options.stylePreset,
					postBuildSourceDir: options.sourceDir,
				});
				cleanupSafe = true;
			} catch (error) {
				if (fs.existsSync(manifest)) {
					const evidence = JSON.parse(
						fs.readFileSync(manifest, 'utf8'),
					);
					cleanupSafe =
						evidence.execution?.processCleanupVerified === true;
					if (
						!fs.existsSync(outputDocx) &&
						!fs.existsSync(manifestPath)
					) {
						fs.copyFileSync(manifest, manifestPath);
					}
				}
				throw error;
			}
		},
		publish(): WordRenderResult {
			const evidence = JSON.parse(fs.readFileSync(manifest, 'utf8'));
			if (
				evidence.status !== 'accepted' ||
				!evidence.execution.processCleanupVerified ||
				!evidence.stablePageCount
			) {
				throw new Error(
					'Word renderer did not produce verified acceptance evidence.',
				);
			}
			evidence.inputDocx.path = null;
			evidence.acceptedDocx.path = outputDocx;
			if (pdfPath) evidence.pdf.path = pdfPath;
			else {
				evidence.pdf = null;
				evidence.capabilityChecks.exportedPdf = false;
			}
			evidence.postBuild.pdf_path = pdfPath ?? null;
			evidence.internalPdfVerified = true;
			fs.writeFileSync(
				manifest,
				`${JSON.stringify(evidence, null, 2)}\n`,
			);
			const outputs = [
				[acceptedDocx, outputDocx],
				...(pdfPath ? [[pdf, pdfPath]] : []),
				[manifest, manifestPath],
			];
			const published: string[] = [];
			const backups: [string, string][] = [];
			try {
				for (const [source, target] of outputs) {
					if (fs.existsSync(target)) {
						const backup = path.join(
							staging,
							`backup-${backups.length}`,
						);
						fs.renameSync(target, backup);
						backups.push([backup, target]);
					}
					fs.renameSync(source, target);
					published.push(target);
				}
			} catch (error) {
				try {
					for (const target of published.reverse())
						fs.unlinkSync(target);
					for (const [backup, target] of backups.reverse())
						fs.renameSync(backup, target);
				} catch (rollbackError) {
					cleanupSafe = false;
					throw new Error(
						`Word publication rollback failed; backups retained in ${staging}`,
						{ cause: rollbackError },
					);
				}
				throw error;
			}
			return {
				manifest: manifestPath,
				...(pdfPath ? { pdf: pdfPath } : {}),
			};
		},
		close() {
			if (!cleanupSafe) {
				console.error(
					`Word cleanup is unverified; staging and destination locks retained: ${staging}`,
				);
				return;
			}
			fs.rmSync(staging, { recursive: true, force: true });
			for (const lock of locks) fs.unlinkSync(lock);
		},
	};
}
