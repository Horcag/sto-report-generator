import { Token, TokenizerThis } from 'marked';

import { SUPPORTED_STO_ENVIRONMENTS } from '@/shared/config';

export const stoExtension = {
	name: 'stoFlag',
	level: 'block' as const,
	start(src: string) {
		return src.match(/\\sto_structural_heading\{|\\begin\{/)?.index;
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
			const blockTokens: Token[] = [];
			this.lexer.blockTokens(content, blockTokens);
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
