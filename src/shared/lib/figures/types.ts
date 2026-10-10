export interface FigureCrop {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export interface FigureDefaults {
	maxWidthMm?: number;
	maxHeightMm?: number;
	minDpi?: number;
	minTextPt?: number;
	quality?: 'warn' | 'error';
}

export interface FigureSpec {
	source?: string;
	widthMm?: number;
	maxHeightMm?: number;
	crop?: FigureCrop;
	fallback?: string;
	textSizePx?: number;
}

export interface FigureSettings {
	defaults: FigureDefaults;
	figures: Record<string, FigureSpec>;
}

export interface FigureIssue {
	code: string;
	severity: 'warn' | 'error';
	message: string;
}

export interface FigurePlan {
	id: string;
	asset: string;
	sourcePath: string;
	sourceHash: string;
	type: 'png' | 'jpg' | 'gif' | 'bmp' | 'svg';
	intrinsicPx: { width: number; height: number };
	widthMm: number;
	heightMm: number;
	crop: FigureCrop;
	effectiveDpi: { x: number; y: number };
	minTextPt?: number;
	fallbackPath?: string;
	fallbackHash?: string;
	issues: FigureIssue[];
}
