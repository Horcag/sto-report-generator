export const STO_STYLE_PRESET_NAMES = [
	'samara-template-2022',
	'default',
	'sto-strict',
] as const;
export const DEFAULT_STO_STYLE_PRESET = 'samara-template-2022';

export type StoStylePreset = (typeof STO_STYLE_PRESET_NAMES)[number];

export function isStoStylePreset(value: unknown): value is StoStylePreset {
	return (
		typeof value === 'string' &&
		STO_STYLE_PRESET_NAMES.includes(value as StoStylePreset)
	);
}

export function resolveStoStylePreset(
	override: unknown,
	fallback: unknown,
): StoStylePreset {
	if (override !== undefined && !isStoStylePreset(override)) {
		throw new Error(
			`Unknown style preset "${String(override)}". Supported presets: ${STO_STYLE_PRESET_NAMES.join(', ')}.`,
		);
	}
	return (
		override ??
		(isStoStylePreset(fallback) ? fallback : DEFAULT_STO_STYLE_PRESET)
	);
}
