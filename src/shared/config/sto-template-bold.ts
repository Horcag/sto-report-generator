import { IStylesOptions } from 'docx';

type ParagraphStyle = NonNullable<IStylesOptions['paragraphStyles']>[number];
type BoldTag = 'b' | 'bCs';
interface NormalizedTemplateStyle {
	style: ParagraphStyle;
	inheritedBold: BoldTag[];
}

/** Convert desired portable bold into Word style toggles against the native graph. */
export function normalizeTemplateBold(
	sources: ReadonlyMap<string, string>,
	overrides: readonly ParagraphStyle[],
): ReadonlyMap<string, NormalizedTemplateStyle> {
	const byId = new Map(overrides.map(style => [style.id, style]));
	const cache = new Map<string, boolean>();
	const visiting = new Set<string>();
	const parentId = (id: string) =>
		/<w:basedOn w:val="([^"]+)"/.exec(sources.get(id) ?? '')?.[1];
	for (const id of sources.keys()) {
		const seen = new Set<string>();
		let current: string | undefined = id;
		while (current) {
			if (seen.has(current))
				throw new Error(`Cyclic template bold inheritance: ${current}`);
			seen.add(current);
			current = parentId(current);
		}
	}
	const effective = (id: string | undefined, tag: BoldTag): boolean => {
		if (!id) return false;
		const key = `${id}:${tag}`;
		const cached = cache.get(key);
		if (cached !== undefined) return cached;
		if (visiting.has(key))
			throw new Error(`Cyclic template bold inheritance: ${id}`);
		visiting.add(key);
		const run = byId.get(id)?.run;
		const desired =
			tag === 'b' ? run?.bold : (run?.boldComplexScript ?? run?.bold);
		let result: boolean;
		if (desired !== undefined) result = desired;
		else {
			const runXml =
				/<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(sources.get(id) ?? '')?.[1] ??
				'';
			const toggle = new RegExp(`<w:${tag}\\b[^>]*\\/>`).exec(
				runXml,
			)?.[0];
			const value = toggle && /w:val="([^"]+)"/.exec(toggle)?.[1];
			const enabled =
				Boolean(toggle) &&
				!['0', 'false', 'off'].includes(value ?? 'true');
			result =
				toggle && !enabled
					? false
					: effective(parentId(id), tag) !== enabled;
		}
		visiting.delete(key);
		cache.set(key, result);
		return result;
	};
	return new Map(
		overrides.map((style): [string, NormalizedTemplateStyle] => {
			const run = style.run;
			if (run?.bold === undefined && run?.boldComplexScript === undefined)
				return [style.id, { style, inheritedBold: [] }];
			if (run.bold === false || run.boldComplexScript === false)
				throw new Error(
					`Portable regular-bold override is unsupported for native style ${style.id}.`,
				);
			const parent = parentId(style.id);
			const inheritedBold = (['b', 'bCs'] as const).filter(tag => {
				const desired =
					tag === 'b'
						? run.bold
						: (run.boldComplexScript ?? run.bold);
				return desired === true && effective(parent, tag);
			});
			return [
				style.id,
				{
					inheritedBold,
					style: {
						...style,
						run: {
							...run,
							...(run.bold === undefined
								? {}
								: {
										bold:
											run.bold !== effective(parent, 'b'),
									}),
							boldComplexScript:
								(run.boldComplexScript ?? run.bold) !==
								effective(parent, 'bCs'),
						},
					},
				},
			];
		}),
	);
}
