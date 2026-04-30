import { Token, TokenizerThis } from 'marked';

export const stoExtension = {
	name: 'stoFlag',
	level: 'block',
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

		rule = /^\\begin\{([^}]+)\}([\s\S]*?)\\end\{\1\}/;
		match = rule.exec(src);
		if (match) {
			const envName = match[1];
			const content = match[2];
			const blockTokens: Token[] = [];
			this.lexer.blockTokens(content, blockTokens);
			return {
				type: 'stoFlag',
				raw: match[0],
				flagType: 'environment',
				envName: envName,
				tokens: blockTokens,
			};
		}
	},
};
