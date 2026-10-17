import { marked, Token, Tokens } from 'marked';

import { parseReportFrontmatter as matter } from '@/shared/lib/frontmatter';

export interface FigureOccurrence {
	id: string;
	asset: string;
	caption: string;
	file: string;
	occurrence: number;
}

export interface FigureTokenOccurrence {
	id: string;
	asset: string;
	caption: string;
	occurrence: number;
	token: Tokens.Image;
	blockToken: Token;
}

/** The parser and inspector share token identities, ordering and caption binding. */
export function collectFigureTokenOccurrences(
	tokens: Token[],
): FigureTokenOccurrence[] {
	const result: FigureTokenOccurrence[] = [];
	const used = new Set<string>();
	const walk = (tokens: Token[]): void => {
		for (let i = 0; i < tokens.length; i++) {
			if (tokens[i].type === 'list') {
				(tokens[i] as Tokens.List).items.forEach(item =>
					walk(item.tokens),
				);
				continue;
			}
			if (tokens[i].type === 'stoFlag') {
				const nested = (tokens[i] as Token & { tokens?: Token[] })
					.tokens;
				if (nested) walk(nested);
				continue;
			}
			const images: Tokens.Image[] = [];
			marked.walkTokens([tokens[i]], token => {
				if (token.type === 'image') images.push(token as Tokens.Image);
			});
			const next = tokens
				.slice(i + 1)
				.find(token => token.type !== 'space' && token.type !== 'html');
			const caption =
				next?.type === 'paragraph' &&
				/^(?:Рисунок|Рис\.)\s+/iu.test((next as Tokens.Paragraph).text)
					? (next as Tokens.Paragraph).text
					: '';
			const anchor = /\(@fig:([a-zA-Z0-9_-]+)\)\s*$/u.exec(caption)?.[1];
			if (anchor && images.length > 1)
				throw new Error(
					`Figure caption ${anchor} is ambiguous for multiple images`,
				);
			for (const token of images) {
				const occurrence = result.length + 1;
				const id = anchor ?? `figure-${occurrence}`;
				if (used.has(id))
					throw new Error(`Duplicate figure occurrence ID: ${id}`);
				used.add(id);
				result.push({
					id,
					asset: token.href,
					caption,
					occurrence,
					token,
					blockToken: tokens[i],
				});
			}
		}
	};
	walk(tokens);
	return result;
}

/** Match modular assembly, including captions in the following source module. */
export function collectFigureOccurrences(
	files: Array<{ file: string; content: string }>,
): FigureOccurrence[] {
	let content = '';
	const modules = files.map(file => {
		const start = content.length;
		content += matter(file.content).content + '\n\n';
		return { file: file.file, start };
	});
	const tokens = marked.lexer(content);
	const origins = new WeakMap<Token, string>();
	let offset = 0;
	for (const token of tokens) {
		const file =
			[...modules].reverse().find(module => module.start <= offset)
				?.file ?? '';
		marked.walkTokens([token], nested => {
			origins.set(nested, file);
		});
		offset += token.raw.length;
	}
	return collectFigureTokenOccurrences(tokens).map(
		({ id, asset, caption, occurrence, blockToken }) => ({
			id,
			asset,
			caption,
			occurrence,
			file: origins.get(blockToken) ?? '',
		}),
	);
}
