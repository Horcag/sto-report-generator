import { compareStoTerms, parseStoTermLine } from '@/shared/config';

import { SourceFile, SourcePreflightIssue } from './types';
import { issue, lineNumberAt } from './utils';

const TERMS_HEADING = 'ОПРЕДЕЛЕНИЯ, ОБОЗНАЧЕНИЯ И СОКРАЩЕНИЯ';
const TERMS_BLOCK = /\\begin\{sto_terms\}([\s\S]*?)\\end\{sto_terms\}/g;

export function validateTerms(
	files: SourceFile[],
	issues: SourcePreflightIssue[],
): void {
	for (const { file, content } of files) {
		const hasHeading = content.includes(
			`\\sto_structural_heading{${TERMS_HEADING}}`,
		);
		const blocks = [...content.matchAll(TERMS_BLOCK)];
		if (hasHeading && blocks.length === 0) {
			issues.push(
				issue(
					'sto-terms-missing',
					'definitions section requires a sto_terms block.',
					file,
				),
			);
		}
		if (blocks.length > 0 && !hasHeading) {
			issues.push(
				issue(
					'sto-terms-heading-missing',
					'sto_terms requires the definitions structural heading in the same file.',
					file,
				),
			);
		}
		if (blocks.length > 1) {
			issues.push(
				issue(
					'sto-terms-duplicate',
					'definitions section must have one sto_terms block.',
					file,
				),
			);
		}
		for (const block of blocks) {
			const start = (block.index ?? 0) + block[0].indexOf(block[1]);
			const lines = block[1].split(/\r?\n/);
			let previous: string | undefined;
			let found = false;
			let offset = start;
			for (const line of lines) {
				if (line.trim()) {
					found = true;
					const entry = parseStoTermLine(line);
					const number = lineNumberAt(content, offset);
					if (!entry) {
						issues.push(
							issue(
								'sto-term-row-invalid',
								'use term | explanation | optional unit.',
								file,
								number,
							),
						);
					} else {
						if (
							previous &&
							compareStoTerms(previous, entry.term) >= 0
						) {
							issues.push(
								issue(
									'sto-terms-order',
									'terms must be unique and in Russian alphabetical order.',
									file,
									number,
								),
							);
						}
						previous = entry.term;
					}
				}
				offset += line.length + 1;
			}
			if (!found)
				issues.push(
					issue(
						'sto-terms-empty',
						'sto_terms requires at least one row.',
						file,
						lineNumberAt(content, start),
					),
				);
		}
	}
}
