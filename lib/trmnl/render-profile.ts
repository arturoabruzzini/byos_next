import { hexToRgb, type RGB } from "@/utils/image-processing";
import type { TrmnlPalette } from "./registry";

export type DitheringMethodName = "floyd-steinberg" | "none";

/**
 * Fully-resolved, IO-free description of how to quantize and encode a render
 * for a given palette. Produced by `resolveRenderProfile` and threaded through
 * the renderer so the rendering code never touches the registry directly.
 */
export type ResolvedRenderProfile = {
	paletteId: string;
	isColor: boolean;
	isContinuous: boolean;
	/** RGB tuples for color palettes; null for grayscale / continuous. */
	colors: RGB[] | null;
	/** Gray level count (2/4/16/256) for the grayscale path. */
	levels: number;
	/** Bits-per-pixel for the grayscale BMP packer (1/2/4/8); 0 for color. */
	bitDepth: number;
	format: "png" | "bmp";
	ditheringMethod: DitheringMethodName;
};

const normalizeMethod = (
	m?: DitheringMethodName | string | null,
): DitheringMethodName => (m === "none" ? "none" : "floyd-steinberg");

/** A grayscale profile used as the default when no palette is involved. */
export const defaultGrayscaleProfile = (
	levels = 2,
	format: "png" | "bmp" = "bmp",
): ResolvedRenderProfile => ({
	paletteId:
		levels === 256
			? "gray-256"
			: levels === 16
				? "gray-16"
				: levels === 4
					? "gray-4"
					: "bw",
	isColor: false,
	isContinuous: false,
	colors: null,
	levels,
	bitDepth: levels === 256 ? 8 : levels === 16 ? 4 : levels === 4 ? 2 : 1,
	format,
	ditheringMethod: "floyd-steinberg",
});

/**
 * Pure resolver: turn a palette (or null) + user options into a render profile.
 * - color palettes  → png, dithered to the palette's exact colors
 * - continuous (color-12bit/24bit) → png pass-through, no dithering
 * - grayscale       → bmp (or png if requested / >16 levels), N gray levels
 */
export function resolveRenderProfile(
	palette: TrmnlPalette | null,
	opts: {
		ditheringMethod?: DitheringMethodName | string | null;
		imageFormat?: "png" | "bmp";
	} = {},
): ResolvedRenderProfile {
	const ditheringMethod = normalizeMethod(opts.ditheringMethod);

	if (!palette) {
		return {
			paletteId: "bw",
			isColor: false,
			isContinuous: false,
			colors: null,
			levels: 2,
			bitDepth: 1,
			format: opts.imageFormat === "png" ? "png" : "bmp",
			ditheringMethod,
		};
	}

	const hasColors = Array.isArray(palette.colors) && palette.colors.length > 0;
	const isContinuous = palette.id.startsWith("color-") && !hasColors;

	if (hasColors) {
		return {
			paletteId: palette.id,
			isColor: true,
			isContinuous: false,
			colors: (palette.colors as string[]).map(hexToRgb),
			levels: 2,
			bitDepth: 0,
			format: "png",
			ditheringMethod,
		};
	}

	if (isContinuous) {
		return {
			paletteId: palette.id,
			isColor: false,
			isContinuous: true,
			colors: null,
			levels: 2,
			bitDepth: 0,
			format: "png",
			ditheringMethod: "none",
		};
	}

	const levels =
		palette.grays && [2, 4, 16, 256].includes(palette.grays)
			? palette.grays
			: 2;
	const bitDepth =
		levels === 256 ? 8 : levels === 16 ? 4 : levels === 4 ? 2 : 1;
	const canBmp = levels === 2 || levels === 4 || levels === 16;
	const format = !canBmp ? "png" : opts.imageFormat === "png" ? "png" : "bmp";

	return {
		paletteId: palette.id,
		isColor: false,
		isContinuous: false,
		colors: null,
		levels,
		bitDepth,
		format,
		ditheringMethod,
	};
}
