import { validatePng } from '@/shared/lib/figures';

export interface PayloadEvidence {
	sha256: string;
	bytes: number;
	format: string | null;
	pixelDataValid: boolean | null;
	validationError: string | null;
	kind: 'raster' | 'vector' | 'unknown';
	pixelWidth: number | null;
	pixelHeight: number | null;
	effectiveDpi: { x: number; y: number } | null;
}
export function inspectRasterValidity(data: Buffer, imageFormat?: string) {
	const format =
		imageFormat ??
		(data
			.subarray(0, 8)
			.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
			? 'png'
			: null);
	let pixelDataValid: boolean | null = null;
	let validationError: string | null = null;
	if (format === 'png') {
		try {
			validatePng(data);
			pixelDataValid = true;
		} catch (error) {
			pixelDataValid = false;
			validationError =
				error instanceof Error ? error.message : String(error);
		}
	}
	return { format, pixelDataValid, validationError };
}
export interface FigurePayloadChecks {
	preserved: boolean;
	vectorBytesPreserved: boolean | null;
	rasterBytesPreserved: boolean | null;
	fallbackRegenerated: boolean;
	fallbackRegeneration: {
		reason: string;
		source: PayloadEvidence;
		accepted: PayloadEvidence;
	} | null;
}
function stablePayloads(payloads: PayloadEvidence[]) {
	return payloads.map(payload => ({
		sha256: payload.sha256,
		bytes: payload.bytes,
		kind: payload.kind,
		pixelWidth: payload.pixelWidth,
		pixelHeight: payload.pixelHeight,
	}));
}
function equal(before: PayloadEvidence[], after: PayloadEvidence[]): boolean {
	return (
		JSON.stringify(stablePayloads(before)) ===
		JSON.stringify(stablePayloads(after))
	);
}

export function compareFigurePayloads(
	before: PayloadEvidence[],
	after: PayloadEvidence[] | null,
): FigurePayloadChecks {
	const vectors = before.filter(item => item.kind === 'vector');
	const acceptedVectors = after?.filter(item => item.kind === 'vector') ?? [];
	const rasters = before.filter(item => item.kind === 'raster');
	const acceptedRasters = after?.filter(item => item.kind === 'raster') ?? [];
	const vectorBytesPreserved = vectors.length
		? equal(vectors, acceptedVectors)
		: null;
	const rasterBytesPreserved = rasters.length
		? equal(rasters, acceptedRasters)
		: null;
	const sourceFallback = rasters[0];
	const acceptedFallback = acceptedRasters[0];
	// Native Word can regenerate the preview PNG while retaining the authoritative
	// SVG bytes. Primary raster pictures have no such exception.
	const fallbackRegenerated =
		!!after &&
		vectorBytesPreserved === true &&
		rasterBytesPreserved === false &&
		vectors.length + rasters.length === before.length &&
		acceptedVectors.length + acceptedRasters.length === after.length &&
		sourceFallback?.format === 'png' &&
		acceptedFallback?.format === 'png' &&
		sourceFallback.pixelDataValid === true &&
		acceptedFallback.pixelDataValid === true &&
		rasters.length === 1 &&
		acceptedRasters.length === 1 &&
		sourceFallback.pixelWidth !== null &&
		sourceFallback.pixelHeight !== null &&
		acceptedFallback.pixelWidth !== null &&
		acceptedFallback.pixelHeight !== null &&
		acceptedFallback.pixelWidth >= sourceFallback.pixelWidth &&
		acceptedFallback.pixelHeight >= sourceFallback.pixelHeight &&
		Math.abs(
			sourceFallback.pixelWidth / sourceFallback.pixelHeight -
				acceptedFallback.pixelWidth / acceptedFallback.pixelHeight,
		) /
			(sourceFallback.pixelWidth / sourceFallback.pixelHeight) <=
			0.01 &&
		!!sourceFallback.effectiveDpi &&
		!!acceptedFallback.effectiveDpi &&
		acceptedFallback.effectiveDpi.x >= sourceFallback.effectiveDpi.x &&
		acceptedFallback.effectiveDpi.y >= sourceFallback.effectiveDpi.y;
	return {
		preserved:
			!!after &&
			[...before, ...after].every(
				payload => payload.pixelDataValid !== false,
			) &&
			(equal(before, after) || fallbackRegenerated),
		vectorBytesPreserved,
		rasterBytesPreserved,
		fallbackRegenerated,
		fallbackRegeneration: fallbackRegenerated
			? {
					reason: 'Word regenerated the raster preview of an unchanged authoritative vector without reducing pixel dimensions or effective DPI. Preview bytes differ; visual PDF review is required to assess rendering and fonts.',
					source: sourceFallback,
					accepted: acceptedFallback,
				}
			: null,
	};
}
