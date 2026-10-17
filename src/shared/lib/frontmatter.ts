import matter from 'gray-matter';
import {
	binaryTag,
	CORE_SCHEMA,
	load,
	mergeTag,
	omapTag,
	pairsTag,
	setTag,
	timestampTag,
} from 'js-yaml';

// js-yaml 5 defaults to Core Schema. Retain the report metadata semantics
// of js-yaml 4: YAML 1.2 numbers, timestamps and anchor merge keys.
const schema = CORE_SCHEMA.withTags(
	mergeTag,
	timestampTag,
	binaryTag,
	omapTag,
	pairsTag,
	setTag,
);

export function parseReportFrontmatter(input: string) {
	return matter(input, {
		engines: {
			yaml: value => load(value, { schema }) as object,
		},
	});
}
