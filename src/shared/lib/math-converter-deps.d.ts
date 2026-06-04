declare module '@hungknguyen/mathml2omml' {
	export function mml2omml(
		mml: string,
		options?: { disableDecode?: boolean },
	): string;
}

declare module 'mathjax' {
	export interface MathJaxApi {
		tex2mml(latex: string): string;
	}

	export function init(options: unknown): Promise<MathJaxApi>;

	const mathjax: {
		init: typeof init;
	};
	export default mathjax;
}
