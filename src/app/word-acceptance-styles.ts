import fs from 'node:fs';

import {
	DEFAULT_STO_STYLE_PRESET,
	getStoStylePresetDisplayNames,
	getStoStyles,
	isStoStylePreset,
	StoStylePreset,
} from '@/shared/config';
import { isStrictStoDocx } from '@/shared/lib/docx';

export function getWordAcceptanceExpectedStyles(
	stylePreset: StoStylePreset,
): Array<{ styleId: string; displayName: string }> {
	if (stylePreset === 'sto-strict') {
		return (getStoStyles('default').paragraphStyles ?? []).map(style => ({
			styleId: style.id,
			displayName: style.name ?? style.id,
		}));
	}
	return Object.entries(getStoStylePresetDisplayNames(stylePreset)).map(
		([styleId, displayName]) => ({ styleId, displayName }),
	);
}

export function resolveWordAcceptanceStylePreset(
	inputDocx: string,
	requested?: StoStylePreset,
): StoStylePreset {
	const strictDocument =
		fs.existsSync(inputDocx) && isStrictStoDocx(inputDocx);
	if (strictDocument && requested && requested !== 'sto-strict') {
		throw new Error(
			'The DOCX declares sto-strict; a conflicting Word acceptance preset is not allowed.',
		);
	}
	if (requested === 'sto-strict' && !strictDocument) {
		throw new Error(
			'Strict Word acceptance requires a DOCX marked with STOStylePreset=sto-strict.',
		);
	}
	const stylePreset =
		requested ?? (strictDocument ? 'sto-strict' : DEFAULT_STO_STYLE_PRESET);
	if (!isStoStylePreset(stylePreset)) {
		throw new Error(
			'Supported style presets for Word acceptance: samara-template-2022, default, sto-strict.',
		);
	}
	return stylePreset;
}

export function assertStrictStoMarker(
	inputDocx: string,
	preset: StoStylePreset,
): void {
	if (preset === 'sto-strict' && !isStrictStoDocx(inputDocx)) {
		throw new Error(
			'Word acceptance rejected strict DOCX: STOStylePreset marker was lost.',
		);
	}
}
