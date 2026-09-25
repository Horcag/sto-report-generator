import { Token, Tokens } from 'marked';

import { APPENDIX_LABELS } from '@/shared/config';

const APPENDIX = /^ПРИЛОЖЕНИЕ\s+([А-Я])$/i;

export class ReferenceRegistry {
	private readonly appendixLabels = new Set<string>();

	public constructor(private readonly itemMap: Map<string, string>) {}

	public assignNumbers(tokens: Token[]): void {
		const main = { fig: 0, tab: 0, eq: 0 };
		const appendixCounters = new Map<string, typeof main>();
		let appendix: string | undefined;

		const assign = (kind: keyof typeof main, label: string): string => {
			const counters = appendix
				? (appendixCounters.get(appendix) ?? { fig: 0, tab: 0, eq: 0 })
				: main;
			if (appendix) appendixCounters.set(appendix, counters);
			const key = `@${kind}:${label}`;
			if (!this.itemMap.has(key)) {
				counters[kind]++;
				this.itemMap.set(
					key,
					appendix
						? `${appendix}.${counters[kind]}`
						: String(counters[kind]),
				);
			}
			return this.itemMap.get(key)!;
		};

		const walk = (items: Token[]): void => {
			for (const token of items) {
				if (token.type === 'stoFlag') {
					const heading = token as Token & {
						flagType: string;
						text?: string;
						appendix?: { label: string };
						tokens?: Token[];
					};
					if (heading.flagType === 'appendix') {
						appendix = heading.appendix?.label.trim().toUpperCase();
						if (appendix) this.appendixLabels.add(appendix);
					} else if (heading.flagType === 'structural_heading') {
						appendix = APPENDIX.exec(
							heading.text?.trim() ?? '',
						)?.[1]?.toUpperCase();
						if (appendix) this.appendixLabels.add(appendix);
					} else if (heading.tokens) walk(heading.tokens);
					continue;
				}
				if (token.type === 'paragraph' || token.type === 'text') {
					const text = (token as Tokens.Paragraph | Tokens.Text).text;
					const caption =
						/^((?:Рисунок|Рис\.|Таблица)\s+)(?:\d+(?:\.\d+)?|[А-Я]\.\d+)(\s+–[\s\S]*?\(@(fig|tab):([a-zA-Z0-9_-]+)\)\s*)$/i.exec(
							text.trim(),
						);
					if (caption) {
						const kind = caption[3] as 'fig' | 'tab';
						const expectedKind = /^Таблица/i.test(caption[1])
							? 'tab'
							: 'fig';
						if (kind === expectedKind) {
							const number = assign(kind, caption[4]);
							const paragraph = token as Tokens.Paragraph;
							paragraph.text = `${caption[1]}${number}${caption[2]}`;
							if (paragraph.tokens?.[0]?.type === 'text') {
								const first = paragraph
									.tokens[0] as Tokens.Text;
								const prefix =
									/^((?:Рисунок|Рис\.|Таблица)\s+)(?:\d+(?:\.\d+)?|[А-Я]\.\d+)/i;
								first.text = first.text.replace(
									prefix,
									`$1${number}`,
								);
								first.raw = first.raw.replace(
									prefix,
									`$1${number}`,
								);
							}
						}
					}
					for (const math of text.matchAll(
						/\$\$[\s\S]*?\(@eq:([a-zA-Z0-9_-]+)\)\s*\$\$/g,
					)) {
						assign('eq', math[1]);
					}
				}
				if (token.type === 'list') {
					(token as Tokens.List).items.forEach(item =>
						walk(item.tokens || []),
					);
				}
			}
		};
		walk(tokens);
	}

	public replaceRefs(text: string): string {
		const appendixText = text.replace(
			/\\sto_appendix_ref\{([^}]*)\}/g,
			(_match, rawLabel: string) => {
				const label = rawLabel.trim().toUpperCase();
				if (
					!APPENDIX_LABELS.includes(
						label as (typeof APPENDIX_LABELS)[number],
					) ||
					!this.appendixLabels.has(label)
				) {
					throw new Error(
						`Unknown appendix reference: ${rawLabel}. Declare the appendix before generating the report.`,
					);
				}
				return `приложении ${label}`;
			},
		);
		return appendixText.replace(
			/@(fig|tab|eq):([a-zA-Z0-9_-]+)/g,
			match => this.itemMap.get(match) ?? `[${match} NOT FOUND]`,
		);
	}
}
