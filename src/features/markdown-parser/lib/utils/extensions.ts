import { Token, TokenizerThis } from 'marked';

import { SUPPORTED_STO_ENVIRONMENTS } from '@/shared/config';

const PARENTHESIZED_ITEM_PATTERN =
	/^([ \t]*)((?:[A-Za-zА-Яа-яЁё]|\d+)\))\s+(.+)$/u;

function tokenizeStoListContent(
	lexer: TokenizerThis['lexer'],
	content: string,
): Token[] {
	const tokens: Token[] = [];
	const ordinaryLines: string[] = [];
	let currentItem:
		| { indentLevel: number; marker: string; contentLines: string[] }
		| undefined;

	const flushOrdinaryLines = () => {
		if (ordinaryLines.some(line => line.trim().length > 0)) {
			lexer.blockTokens(ordinaryLines.join('\n'), tokens);
		}
		ordinaryLines.length = 0;
	};
	const flushParenthesizedItem = () => {
		if (!currentItem) return;
		const text = `${currentItem.marker} ${currentItem.contentLines
			.map(line => line.trim())
			.filter(Boolean)
			.join(' ')}`;
		tokens.push({
			type: 'paragraph',
			raw: text,
			text,
			tokens: lexer.inlineTokens(text),
			stoParenthesizedListItem: true,
			stoParenthesizedIndentLevel: currentItem.indentLevel,
		} as Token);
		currentItem = undefined;
	};

	for (const line of content.split(/\r?\n/)) {
		const itemMatch = PARENTHESIZED_ITEM_PATTERN.exec(line);
		if (itemMatch) {
			flushOrdinaryLines();
			flushParenthesizedItem();
			const indentation = itemMatch[1].replaceAll('\t', '    ').length;
			currentItem = {
				indentLevel: Math.floor(indentation / 2),
				marker: itemMatch[2],
				contentLines: [itemMatch[3]],
			};
			continue;
		}

		if (currentItem && line.trim().length > 0) {
			currentItem.contentLines.push(line);
			continue;
		}

		flushParenthesizedItem();
		ordinaryLines.push(line);
	}

	flushParenthesizedItem();
	flushOrdinaryLines();
	return tokens;
}

export const stoExtension = {
	name: 'stoFlag',
	level: 'block' as const,
	start(src: string) {
		return src.match(
			/\\sto_structural_heading\{|\\sto_appendix\{|\\begin\{/,
		)?.index;
	},
	tokenizer(this: TokenizerThis, src: string, _tokens: Token[]) {
		let rule = /^\\sto_structural_heading\{([^}]+)\}/;
		let match = rule.exec(src);
		if (match) {
			return {
				type: 'stoFlag',
				raw: match[0],
				flagType: 'structural_heading',
				text: match[1],
			};
		}

		match = /^\\sto_appendix\{([^}]+)\}\{([^}]*)\}/.exec(src);
		if (match) {
			return {
				type: 'stoFlag',
				raw: match[0],
				flagType: 'appendix',
				appendix: { label: match[1], title: match[2] },
			};
		}

		rule = /^\\begin\{([^}]+)\}([\s\S]*?)\\end\{([^}]+)\}/;
		match = rule.exec(src);
		if (match) {
			const envName = match[1];
			const closingEnvName = match[3];
			if (envName !== closingEnvName) {
				throw new Error(
					`Unsupported STO environment block: \\begin{${envName}} closes as \\end{${closingEnvName}}.`,
				);
			}

			if (!SUPPORTED_STO_ENVIRONMENTS.has(envName)) {
				throw new Error(
					`Unsupported STO environment: ${envName}. Supported environments: ${[
						...SUPPORTED_STO_ENVIRONMENTS,
					].join(', ')}.`,
				);
			}

			const content = match[2];
			const blockTokens =
				envName === 'sto_list' || envName === 'sto_enum'
					? tokenizeStoListContent(this.lexer, content)
					: this.lexer.blockTokens(content, []);
			return {
				type: 'stoFlag',
				raw: match[0],
				flagType: 'environment',
				envName,
				tokens: blockTokens,
			};
		}

		const openingEnvironmentMatch = /^\\begin\{([^}]+)\}/.exec(src);
		if (openingEnvironmentMatch) {
			throw new Error(
				`Unclosed STO environment: ${openingEnvironmentMatch[1]}. Add matching \\end{${openingEnvironmentMatch[1]}}.`,
			);
		}
	},
};

export const mathExtension = {
	name: 'math',
	level: 'inline' as const,
	start(src: string) {
		return src.match(/\$/)?.index;
	},
	tokenizer(src: string, _tokens: Token[]) {
		const rule = /^\$((?:\\\$|[^$])+)\$/;
		const match = rule.exec(src);
		if (match) {
			return {
				type: 'math',
				raw: match[0],
				text: match[1].trim(),
			};
		}
	},
};
