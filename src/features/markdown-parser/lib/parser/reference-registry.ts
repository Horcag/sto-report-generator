import { Token, Tokens } from 'marked';

export class ReferenceRegistry {
	public constructor(private readonly itemMap: Map<string, number>) {}

	public assignNumbers(tokens: Token[]): void {
		let figCounter = 0;
		let tabCounter = 0;
		let eqCounter = 0;

		const walk = (items: Token[]): void => {
			for (const token of items) {
				if (
					token.type === 'paragraph' ||
					token.type === 'text' ||
					token.type === 'heading'
				) {
					const text =
						'text' in token ? (token.text as string) : token.raw;

					const figMatch = text.match(
						/(?:Рисунок|Рис\.)\s+.*?(@fig:[a-zA-Z0-9_-]+)/,
					);
					if (figMatch && !this.itemMap.has(figMatch[1])) {
						figCounter++;
						this.itemMap.set(figMatch[1], figCounter);
					}

					const tabMatch = text.match(
						/Таблица\s+.*?(@tab:[a-zA-Z0-9_-]+)/,
					);
					if (tabMatch && !this.itemMap.has(tabMatch[1])) {
						tabCounter++;
						this.itemMap.set(tabMatch[1], tabCounter);
					}

					const blockMathMatches = text.matchAll(/\$\$[\s\S]+?\$\$/g);
					for (const blockMathMatch of blockMathMatches) {
						const eqMatch = blockMathMatch[0].match(
							/\((@eq:[a-zA-Z0-9_-]+)\)\s*\$\$/,
						);
						if (eqMatch && !this.itemMap.has(eqMatch[1])) {
							eqCounter++;
							this.itemMap.set(eqMatch[1], eqCounter);
						}
					}
				}

				if ('tokens' in token && token.tokens) {
					walk(token.tokens as Token[]);
				} else if (token.type === 'list') {
					(token as Tokens.List).items.forEach(item =>
						walk(item.tokens || []),
					);
				} else if (token.type === 'table') {
					(token as Tokens.Table).rows.forEach(row =>
						row.forEach(cell => walk(cell.tokens || [])),
					);
				}
			}
		};

		walk(tokens);
	}

	public replaceRefs(text: string): string {
		return text.replace(/@(fig|tab|eq):([a-zA-Z0-9_-]+)/g, match => {
			if (this.itemMap.has(match)) {
				return String(this.itemMap.get(match));
			}
			return `[${match} NOT FOUND]`;
		});
	}
}
