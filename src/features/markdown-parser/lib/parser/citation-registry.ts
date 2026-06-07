import { ParserContext } from '../types';

export function getCitationNumber(context: ParserContext, key: string): number {
	let index = context.citations.indexOf(key);
	if (index === -1) {
		context.citations.push(key);
		index = context.citations.length - 1;
	}
	return index + 1;
}
