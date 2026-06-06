import sharp from "sharp";

/**
 * Encode a raw raster to a PNG buffer.
 * - channels === 3: RGB input → indexed PNG (`palette: true`). With ≤256
 *   distinct colors (all discrete TRMNL palettes) sharp writes a PLTE of
 *   exactly those colors — what a color e-ink panel wants.
 * - channels === 1: grayscale input → grayscale PNG.
 */
export async function encodePng(
	data: Uint8Array,
	width: number,
	height: number,
	channels: 1 | 3,
): Promise<Buffer> {
	const img = sharp(Buffer.from(data), { raw: { width, height, channels } });
	return channels === 3
		? img.png({ palette: true }).toBuffer()
		: img.png().toBuffer();
}
