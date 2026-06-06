import sharp from "sharp";
import { applyDithering, DitheringMethod } from "./image-processing";

export { DitheringMethod };

export interface RenderBmpOptions {
	ditheringMethod?: DitheringMethod;
	inverted?: boolean;
	width?: number;
	height?: number;
	grayscale?: number; // Number of gray levels: 2, 4, or 16
	applyEdgeSnap?: boolean;
}

const createGrayscalePaletteEntries = (grayscale: number): number[] => {
	const paletteStep = 255 / (grayscale - 1);
	return Array.from({ length: grayscale }, (_, index) => {
		const grayValue = Math.round(index * paletteStep);
		return (grayValue << 16) | (grayValue << 8) | grayValue;
	});
};

const mapGrayscaleValueToPaletteIndex = (
	value: number,
	grayscale: number,
): number => {
	const paletteStep = 255 / (grayscale - 1);
	return Math.round(value / paletteStep);
};

const shouldSetMonochromeBit = (
	paletteIndex: number,
	grayscale: number,
): boolean => paletteIndex === grayscale - 1;

/**
 * Pack an already-dithered grayscale raster (one byte per pixel, values on the
 * quantized gray levels) into a 1/2/4-bpp BMP buffer.
 */
export function packGrayscaleBmp(
	gray: Uint8Array,
	width: number,
	height: number,
	options: { grayscale?: number; inverted?: boolean } = {},
): Buffer {
	const grayscale = options.grayscale ?? 2;
	const inverted = options.inverted ?? false;

	const validLevels = [2, 4, 16];
	if (!validLevels.includes(grayscale)) {
		throw new Error(
			`Invalid grayscale value: ${grayscale}. Must be one of: ${validLevels.join(", ")}`,
		);
	}

	const bitsPerPixel = grayscale === 2 ? 1 : grayscale === 4 ? 2 : 4;
	const numColors = grayscale;
	const paletteSize = numColors * 4;

	const fileHeaderSize = 14;
	const infoHeaderSize = 40;
	const rowSize = Math.floor((width * bitsPerPixel + 31) / 32) * 4;
	const headerSize = fileHeaderSize + infoHeaderSize + paletteSize;
	const fileSize = headerSize + rowSize * height;

	const buffer = Buffer.alloc(fileSize);

	buffer.write("BM", 0);
	buffer.writeUInt32LE(fileSize, 2);
	buffer.writeUInt32LE(0, 6);
	buffer.writeUInt32LE(fileHeaderSize + infoHeaderSize + paletteSize, 10);

	buffer.writeUInt32LE(infoHeaderSize, 14);
	buffer.writeInt32LE(width, 18);
	buffer.writeInt32LE(height, 22);
	buffer.writeUInt16LE(1, 26);
	buffer.writeUInt16LE(bitsPerPixel, 28);
	buffer.writeUInt32LE(0, 30);
	buffer.writeUInt32LE(rowSize * height, 34);
	buffer.writeInt32LE(0, 38);
	buffer.writeInt32LE(0, 42);
	buffer.writeUInt32LE(numColors, 46);
	buffer.writeUInt32LE(numColors, 50);

	const paletteOffset = fileHeaderSize + infoHeaderSize;
	const paletteEntries = createGrayscalePaletteEntries(grayscale);
	for (const [index, paletteEntry] of paletteEntries.entries()) {
		buffer.writeUInt32LE(paletteEntry, paletteOffset + index * 4);
	}

	const valueToIndex = (value: number): number =>
		mapGrayscaleValueToPaletteIndex(value, grayscale);

	const dataOffset = headerSize;
	for (let y = 0; y < height; y++) {
		const targetY = height - 1 - y; // BMP is bottom-up
		const yOffset = targetY * width;
		const destRowOffset = dataOffset + y * rowSize;

		if (bitsPerPixel === 1) {
			for (let x = 0; x < width; x += 8) {
				let byte = 0;
				const remaining = Math.min(8, width - x);
				for (let bit = 0; bit < remaining; bit++) {
					let paletteIndex = valueToIndex(gray[yOffset + x + bit]);
					if (inverted) paletteIndex = grayscale - 1 - paletteIndex;
					if (shouldSetMonochromeBit(paletteIndex, grayscale))
						byte |= 1 << (7 - bit);
				}
				buffer[destRowOffset + (x >> 3)] = byte;
			}
		} else if (bitsPerPixel === 2) {
			for (let x = 0; x < width; x += 4) {
				let byte = 0;
				const remaining = Math.min(4, width - x);
				for (let bit = 0; bit < remaining; bit++) {
					let paletteIndex = valueToIndex(gray[yOffset + x + bit]);
					if (inverted) paletteIndex = grayscale - 1 - paletteIndex;
					byte |= paletteIndex << (6 - bit * 2);
				}
				buffer[destRowOffset + (x >> 2)] = byte;
			}
		} else {
			for (let x = 0; x < width; x += 2) {
				let byte = 0;
				const remaining = Math.min(2, width - x);
				for (let bit = 0; bit < remaining; bit++) {
					let paletteIndex = valueToIndex(gray[yOffset + x + bit]);
					if (inverted) paletteIndex = grayscale - 1 - paletteIndex;
					byte |= paletteIndex << (4 - bit * 4);
				}
				buffer[destRowOffset + (x >> 1)] = byte;
			}
		}
	}

	return buffer;
}

/**
 * Back-compat wrapper: render a source PNG straight to a grayscale BMP using
 * the full grayscale dithering algorithm set (Floyd-Steinberg, Atkinson, …).
 * Used by callers that pass a raw PNG + grayscale level + method (the mixup
 * route and the test-img tool both pass `DitheringMethod.ATKINSON`). New code
 * uses quantizeToPalette + packGrayscaleBmp directly; this preserves the legacy
 * behavior for those callers.
 */
export async function renderBmp(
	png: Buffer,
	options: RenderBmpOptions = {},
): Promise<Buffer> {
	const {
		ditheringMethod = DitheringMethod.FLOYD_STEINBERG,
		grayscale = 2,
		applyEdgeSnap: edgeSnap = true,
		inverted = false,
	} = options;
	const targetWidth = options.width ?? 800;
	const targetHeight = options.height ?? 480;

	const metadata = await sharp(png).metadata();
	const isDoubleSize =
		metadata.width === targetWidth * 2 && metadata.height === targetHeight * 2;

	let image = sharp(png);
	if (isDoubleSize) {
		image = image.resize(targetWidth, targetHeight, {
			kernel: sharp.kernel.nearest,
		});
	}

	const { data } = await image
		.resize(targetWidth, targetHeight, { fit: "fill" })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const grayscaleData = new Uint8Array(targetWidth * targetHeight);
	for (let i = 0; i < grayscaleData.length; i++)
		grayscaleData[i] = data[i] as number;

	const dithered = applyDithering(ditheringMethod, grayscaleData, {
		width: targetWidth,
		height: targetHeight,
		levels: grayscale,
		applyEdgeSnap: edgeSnap,
	});

	return packGrayscaleBmp(dithered, targetWidth, targetHeight, {
		grayscale,
		inverted,
	});
}
