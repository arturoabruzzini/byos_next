# Per-Device Dithering & Palettes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each device pick a TRMNL model + palette and a dithering method (Floyd-Steinberg or none), then render its screen by dithering to that palette — for the PNG output as well as the BMP — targeting the Inky Impression 7.3 (`color-7a`, 7 colors).

**Architecture:** Resolve one `ResolvedRenderProfile` from the device's model/palette/method. After the source render, run a single palette-aware quantization pass producing one raster, then encode PNG and/or BMP from that same raster. Color palettes always emit an indexed PNG; grayscale palettes can emit gray PNG or 1/2/4-bpp BMP.

**Tech Stack:** Next.js 16 / React 19, TypeScript, `sharp` (already a dep), Postgres via Kysely, Node's built-in `node:test` (Node v24 strips TS types natively — no test deps added).

**Spec:** `docs/superpowers/specs/2026-06-06-per-device-dithering-palettes-design.md`

---

## File Structure

**New files**
- `utils/encode-png.ts` — encode a raw raster (1 or 3 channel) to a PNG buffer via `sharp`. Replaces the deleted dead `utils/render-png.ts`.
- `lib/trmnl/render-profile.ts` — the pure `resolveRenderProfile()` + `ResolvedRenderProfile`/`DitheringMethodName` types + `defaultGrayscaleProfile()`. Pure (no IO) so it's unit-testable and importable from client code paths.
- `app/api/models/route.ts` — list models from the registry (mirrors `app/api/palettes/route.ts`).
- Test files: `utils/image-processing.test.ts`, `lib/trmnl/render-profile.test.ts`.

**Modified files**
- `utils/image-processing.ts` — add `RGB`, `hexToRgb`, `nearestColorIndex`, `ditherFloydSteinbergColor`, `quantizeToPalette`.
- `utils/render-bmp.ts` — extract `packGrayscaleBmp()`; keep `renderBmp()` as a thin back-compat wrapper.
- `lib/trmnl/device-profile.ts` — add async `resolveDeviceRenderProfile()` that does registry lookups then calls the pure resolver.
- `lib/recipes/recipe-renderer.ts` — thread `profile` through `renderRecipeOutputs`/`renderRecipeToImage`; single quantize pass; encode both outputs from it.
- `app/api/bitmap/[[...slug]]/route.ts` — parse `palette`/`dither` query params → profile.
- `app/api/display/route.ts` — resolve device profile, emit `palette`/`dither` params, pick extension from resolved format.
- `lib/types.ts` + `lib/database/db.d.ts` — `dithering_method` on `Device`.
- `lib/database/sql-statements.ts` — migration `0016_add_device_dithering_method` + backfill.
- `components/device/device-edit-form.tsx` — Model + Palette + Dithering controls; remove grayscale toggle.
- `app/(app)/device/[friendly_id]/client-page.tsx` — fetch models/palettes, pass to form.
- `app/actions/device.ts` — persist `model`, `palette_id`, `dithering_method`.
- `package.json` — `test` script.

**Deleted**
- `utils/render-png.ts` (dead, buggy).

---

## Task 1: Test harness + npm script

**Files:**
- Modify: `package.json` (scripts block)

- [ ] **Step 1: Add a test script**

In `package.json`, add to `"scripts"` (after `"typecheck"`):

```json
		"test": "node --test --experimental-strip-types",
```

- [ ] **Step 2: Verify the runner works with zero tests**

Run: `pnpm test`
Expected: exits 0 with output like `tests 0 ... pass 0` (no test files yet; the warning about `--experimental-strip-types` being unnecessary on Node 24 is harmless).

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add node:test test script"
```

---

## Task 2: Pure render-profile resolver

**Files:**
- Create: `lib/trmnl/render-profile.ts`
- Create: `lib/trmnl/render-profile.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `lib/trmnl/render-profile.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrmnlPalette } from "./registry.ts";
import { resolveRenderProfile } from "./render-profile.ts";

const colorSeven: TrmnlPalette = {
	id: "color-7a",
	name: "Color (7 colors)",
	grays: 2,
	colors: ["#000000", "#FFFFFF", "#FF0000", "#00FF00", "#0000FF", "#FFFF00", "#FFA500"],
};
const gray4: TrmnlPalette = { id: "gray-4", name: "4 Grays", grays: 4 };
const continuous: TrmnlPalette = { id: "color-24bit", name: "Color (16M)", grays: 2 };

test("null palette falls back to bw grayscale bmp", () => {
	const p = resolveRenderProfile(null, {});
	assert.equal(p.paletteId, "bw");
	assert.equal(p.isColor, false);
	assert.equal(p.levels, 2);
	assert.equal(p.format, "bmp");
});

test("color palette parses colors and forces png", () => {
	const p = resolveRenderProfile(colorSeven, { imageFormat: "bmp" });
	assert.equal(p.isColor, true);
	assert.equal(p.colors?.length, 7);
	assert.deepEqual(p.colors?.[2], [255, 0, 0]);
	assert.equal(p.format, "png");
});

test("grayscale palette honors requested format and level count", () => {
	assert.equal(resolveRenderProfile(gray4, {}).format, "bmp");
	assert.equal(resolveRenderProfile(gray4, { imageFormat: "png" }).format, "png");
	assert.equal(resolveRenderProfile(gray4, {}).levels, 4);
	assert.equal(resolveRenderProfile(gray4, {}).bitDepth, 2);
});

test("continuous palette is pass-through png with no dithering", () => {
	const p = resolveRenderProfile(continuous, { ditheringMethod: "floyd-steinberg" });
	assert.equal(p.isContinuous, true);
	assert.equal(p.format, "png");
	assert.equal(p.ditheringMethod, "none");
});

test("dithering method defaults to floyd-steinberg, accepts none", () => {
	assert.equal(resolveRenderProfile(gray4, {}).ditheringMethod, "floyd-steinberg");
	assert.equal(resolveRenderProfile(gray4, { ditheringMethod: "none" }).ditheringMethod, "none");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test --experimental-strip-types lib/trmnl/render-profile.test.ts`
Expected: FAIL — `Cannot find module './render-profile.ts'`.

- [ ] **Step 3: Implement the resolver**

Create `lib/trmnl/render-profile.ts`:

```ts
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

const normalizeMethod = (m?: DitheringMethodName | string | null): DitheringMethodName =>
	m === "none" ? "none" : "floyd-steinberg";

/** A grayscale profile used as the default when no palette is involved. */
export const defaultGrayscaleProfile = (
	levels = 2,
	format: "png" | "bmp" = "bmp",
): ResolvedRenderProfile => ({
	paletteId: levels === 16 ? "gray-16" : levels === 4 ? "gray-4" : "bw",
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
	opts: { ditheringMethod?: DitheringMethodName | string | null; imageFormat?: "png" | "bmp" } = {},
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

	const levels = palette.grays && [2, 4, 16, 256].includes(palette.grays) ? palette.grays : 2;
	const bitDepth = levels === 256 ? 8 : levels === 16 ? 4 : levels === 4 ? 2 : 1;
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
```

> Note: this imports `hexToRgb`/`RGB` from `utils/image-processing` — those are added in Task 3. If you implement strictly in order, Task 3's symbols won't exist yet and the test run in Step 4 will fail to import. **Do Task 3 before running this task's Step 4**, or temporarily inline `hexToRgb` here and refactor in Task 3. Recommended: run Task 3 Steps 1–3 first, then return here. The tasks are ordered this way deliberately; the import is the only cross-dependency.

- [ ] **Step 4: Run the tests to verify they pass** (after Task 3's `hexToRgb` exists)

Run: `node --test --experimental-strip-types lib/trmnl/render-profile.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/trmnl/render-profile.ts lib/trmnl/render-profile.test.ts
git commit -m "feat: pure resolveRenderProfile for palette-aware rendering"
```

---

## Task 3: Color primitives in image-processing

**Files:**
- Modify: `utils/image-processing.ts` (add exports near top, after the existing `quantizeValue`)
- Create: `utils/image-processing.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `utils/image-processing.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ditherFloydSteinbergColor,
	hexToRgb,
	nearestColorIndex,
	type RGB,
} from "./image-processing.ts";

const BW: RGB[] = [
	[0, 0, 0],
	[255, 255, 255],
];

test("hexToRgb parses 6-digit hex", () => {
	assert.deepEqual(hexToRgb("#FF0000"), [255, 0, 0]);
	assert.deepEqual(hexToRgb("00FF00"), [0, 255, 0]);
});

test("nearestColorIndex picks the closest palette entry", () => {
	assert.equal(nearestColorIndex(10, 10, 10, BW), 0);
	assert.equal(nearestColorIndex(200, 200, 200, BW), 1);
});

test("color Floyd-Steinberg diffuses error to the next pixel", () => {
	// Two mid-gray pixels, B/W palette. Pixel 0 rounds to white (127<128),
	// its negative error pushes pixel 1 down to black.
	const rgb = new Uint8Array([128, 128, 128, 128, 128, 128]);
	const out = ditherFloydSteinbergColor(rgb, 2, 1, BW);
	assert.deepEqual([...out], [255, 255, 255, 0, 0, 0]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test --experimental-strip-types utils/image-processing.test.ts`
Expected: FAIL — `hexToRgb` / `nearestColorIndex` / `ditherFloydSteinbergColor` not exported.

- [ ] **Step 3: Implement the primitives**

In `utils/image-processing.ts`, add immediately after the `quantizeValue` export (top of file):

```ts
export type RGB = [number, number, number];

/** Parse "#RRGGBB" or "RRGGBB" into an [r,g,b] tuple. */
export const hexToRgb = (hex: string): RGB => {
	const h = hex.replace("#", "");
	return [
		parseInt(h.slice(0, 2), 16),
		parseInt(h.slice(2, 4), 16),
		parseInt(h.slice(4, 6), 16),
	];
};

/** Index of the palette color nearest to (r,g,b) by squared Euclidean distance. */
export const nearestColorIndex = (
	r: number,
	g: number,
	b: number,
	palette: RGB[],
): number => {
	let best = 0;
	let bestDist = Number.POSITIVE_INFINITY;
	for (let i = 0; i < palette.length; i++) {
		const [pr, pg, pb] = palette[i];
		const dr = r - pr;
		const dg = g - pg;
		const db = b - pb;
		const dist = dr * dr + dg * dg + db * db;
		if (dist < bestDist) {
			bestDist = dist;
			best = i;
		}
	}
	return best;
};

/** Flat (no diffusion) nearest-color quantization of an RGB buffer to a palette. */
export const flatNearestColor = (rgb: Uint8Array, palette: RGB[]): Uint8Array => {
	const out = new Uint8Array(rgb.length);
	for (let i = 0; i < rgb.length; i += 3) {
		const [r, g, b] = palette[nearestColorIndex(rgb[i], rgb[i + 1], rgb[i + 2], palette)];
		out[i] = r;
		out[i + 1] = g;
		out[i + 2] = b;
	}
	return out;
};

/**
 * Floyd-Steinberg error diffusion in RGB space, snapping each pixel to the
 * nearest palette color. Input/output are packed RGB (3 bytes/pixel).
 */
export const ditherFloydSteinbergColor = (
	rgb: Uint8Array,
	width: number,
	height: number,
	palette: RGB[],
): Uint8Array => {
	const buf = Float32Array.from(rgb);
	const out = new Uint8Array(rgb.length);
	const diffuse = (i: number, er: number, eg: number, eb: number, f: number) => {
		buf[i] += er * f;
		buf[i + 1] += eg * f;
		buf[i + 2] += eb * f;
	};
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 3;
			const r = buf[i];
			const g = buf[i + 1];
			const b = buf[i + 2];
			const [nr, ng, nb] = palette[nearestColorIndex(r, g, b, palette)];
			out[i] = nr;
			out[i + 1] = ng;
			out[i + 2] = nb;
			const er = r - nr;
			const eg = g - ng;
			const eb = b - nb;
			if (x + 1 < width) diffuse(i + 3, er, eg, eb, 7 / 16);
			if (y + 1 < height) {
				const down = i + width * 3;
				if (x > 0) diffuse(down - 3, er, eg, eb, 3 / 16);
				diffuse(down, er, eg, eb, 5 / 16);
				if (x + 1 < width) diffuse(down + 3, er, eg, eb, 1 / 16);
			}
		}
	}
	return out;
};
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test --experimental-strip-types utils/image-processing.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add utils/image-processing.ts utils/image-processing.test.ts
git commit -m "feat: color nearest-color + Floyd-Steinberg primitives"
```

---

## Task 4: `quantizeToPalette` dispatcher

**Files:**
- Modify: `utils/image-processing.ts` (add at end of file)
- Modify: `utils/image-processing.test.ts` (add cases)

- [ ] **Step 1: Add failing tests**

Append to `utils/image-processing.test.ts`:

```ts
import { quantizeToPalette } from "./image-processing.ts";
import type { ResolvedRenderProfile } from "@/lib/trmnl/render-profile";

const colorProfile: ResolvedRenderProfile = {
	paletteId: "bwr", isColor: true, isContinuous: false,
	colors: [[0, 0, 0], [255, 255, 255]], levels: 2, bitDepth: 0,
	format: "png", ditheringMethod: "floyd-steinberg",
};
const grayProfile: ResolvedRenderProfile = {
	paletteId: "bw", isColor: false, isContinuous: false,
	colors: null, levels: 2, bitDepth: 1, format: "bmp", ditheringMethod: "floyd-steinberg",
};
const continuousProfile: ResolvedRenderProfile = {
	paletteId: "color-24bit", isColor: false, isContinuous: true,
	colors: null, levels: 2, bitDepth: 0, format: "png", ditheringMethod: "none",
};

test("quantizeToPalette: color path returns 3 channels", () => {
	const rgb = new Uint8Array([200, 200, 200, 30, 30, 30]);
	const { data, channels } = quantizeToPalette(rgb, 2, 1, colorProfile);
	assert.equal(channels, 3);
	assert.deepEqual([...data], [255, 255, 255, 0, 0, 0]);
});

test("quantizeToPalette: grayscale path returns 1 channel", () => {
	const rgb = new Uint8Array([200, 200, 200, 30, 30, 30]);
	const { data, channels } = quantizeToPalette(rgb, 2, 1, grayProfile, { applyEdgeSnap: false });
	assert.equal(channels, 1);
	assert.equal(data.length, 2);
	assert.equal(data[0], 255);
	assert.equal(data[1], 0);
});

test("quantizeToPalette: continuous path passes RGB through unchanged", () => {
	const rgb = new Uint8Array([12, 34, 56]);
	const { data, channels } = quantizeToPalette(rgb, 1, 1, continuousProfile);
	assert.equal(channels, 3);
	assert.deepEqual([...data], [12, 34, 56]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test --experimental-strip-types utils/image-processing.test.ts`
Expected: FAIL — `quantizeToPalette` not exported.

- [ ] **Step 3: Implement the dispatcher**

Append to `utils/image-processing.ts`:

```ts
import type { ResolvedRenderProfile } from "@/lib/trmnl/render-profile";

/**
 * Quantize a full-color RGB raster to a device's palette, returning the
 * dithered raster plus its channel count (1 = grayscale, 3 = color). This is
 * the single pass that both the PNG and BMP encoders derive from.
 */
export function quantizeToPalette(
	rgb: Uint8Array,
	width: number,
	height: number,
	profile: ResolvedRenderProfile,
	opts: { applyEdgeSnap?: boolean } = {},
): { data: Uint8Array; channels: 1 | 3 } {
	if (profile.isContinuous) {
		return { data: rgb, channels: 3 };
	}

	if (profile.isColor && profile.colors) {
		const data =
			profile.ditheringMethod === "none"
				? flatNearestColor(rgb, profile.colors)
				: ditherFloydSteinbergColor(rgb, width, height, profile.colors);
		return { data, channels: 3 };
	}

	// Grayscale: luma-convert then reuse the existing leveled dithering.
	const gray = new Uint8Array(width * height);
	for (let p = 0; p < gray.length; p++) {
		const i = p * 3;
		gray[p] = Math.round(0.299 * rgb[i] + 0.587 * rgb[i + 1] + 0.114 * rgb[i + 2]);
	}
	const method =
		profile.ditheringMethod === "none" ? DitheringMethod.NONE : DitheringMethod.FLOYD_STEINBERG;
	const data = applyDithering(method, gray, {
		width,
		height,
		levels: profile.levels,
		applyEdgeSnap: opts.applyEdgeSnap ?? false,
	});
	return { data, channels: 1 };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node --test --experimental-strip-types utils/image-processing.test.ts`
Expected: PASS — 6 tests total.

- [ ] **Step 5: Run the profile tests too (cross-check Task 2 import)**

Run: `node --test --experimental-strip-types lib/trmnl/render-profile.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add utils/image-processing.ts utils/image-processing.test.ts
git commit -m "feat: quantizeToPalette dispatcher (color/grayscale/continuous)"
```

---

## Task 5: PNG encoder

**Files:**
- Create: `utils/encode-png.ts`
- Delete: `utils/render-png.ts`

- [ ] **Step 1: Create the encoder**

Create `utils/encode-png.ts`:

```ts
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
```

- [ ] **Step 2: Delete the dead module**

Run: `git rm utils/render-png.ts`
Expected: file removed. (Confirmed unused earlier: `grep -rn "render-png\|renderPng" app lib utils` returns only its own definition.)

- [ ] **Step 3: Verify nothing imported it**

Run: `grep -rn "render-png\|renderPng" app lib utils components || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add utils/encode-png.ts
git commit -m "feat: PNG encoder for dithered rasters; remove dead render-png"
```

---

## Task 6: Split `renderBmp` into a grayscale packer

**Files:**
- Modify: `utils/render-bmp.ts`

- [ ] **Step 1: Extract `packGrayscaleBmp` and rewrite `renderBmp` as a wrapper**

Replace the entire body of `utils/render-bmp.ts` with:

```ts
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

const mapGrayscaleValueToPaletteIndex = (value: number, grayscale: number): number => {
	const paletteStep = 255 / (grayscale - 1);
	return Math.round(value / paletteStep);
};

const shouldSetMonochromeBit = (paletteIndex: number, grayscale: number): boolean =>
	paletteIndex === grayscale - 1;

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
					if (shouldSetMonochromeBit(paletteIndex, grayscale)) byte |= 1 << (7 - bit);
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
export async function renderBmp(png: Buffer, options: RenderBmpOptions = {}): Promise<Buffer> {
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
		image = image.resize(targetWidth, targetHeight, { kernel: sharp.kernel.nearest });
	}

	const { data } = await image
		.resize(targetWidth, targetHeight, { fit: "fill" })
		.grayscale()
		.raw()
		.toBuffer({ resolveWithObject: true });

	const grayscaleData = new Uint8Array(targetWidth * targetHeight);
	for (let i = 0; i < grayscaleData.length; i++) grayscaleData[i] = data[i] as number;

	const dithered = applyDithering(ditheringMethod, grayscaleData, {
		width: targetWidth,
		height: targetHeight,
		levels: grayscale,
		applyEdgeSnap: edgeSnap,
	});

	return packGrayscaleBmp(dithered, targetWidth, targetHeight, { grayscale, inverted });
}
```

> `renderBmp` keeps using `applyDithering` directly so legacy callers retain access to all six algorithms; only the new pipeline (Task 7) goes through the FS/none `quantizeToPalette`. `render-bmp.ts` therefore has no dependency on `render-profile.ts`.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors. (`renderBmp` is now `async` returning `Promise<Buffer>` — it already was awaited by all callers.)

- [ ] **Step 3: Sanity-check callers still compile**

Run: `grep -rn "renderBmp(" app lib`
Expected: matches in `lib/recipes/recipe-renderer.ts` (replaced in Task 7) and any mixup route — all already `await` the call.

- [ ] **Step 4: Commit**

```bash
git add utils/render-bmp.ts
git commit -m "refactor: split packGrayscaleBmp out of renderBmp; share quantize pass"
```

---

## Task 7: Pipeline — single quantize pass feeds PNG + BMP

**Files:**
- Modify: `lib/recipes/recipe-renderer.ts:243-360` (the `RenderOptions` type and `renderRecipeOutputs`) and the `renderRecipeToImage` signature (`:472-522`)

- [ ] **Step 1: Update imports**

In `lib/recipes/recipe-renderer.ts`, replace the line:

```ts
import { DitheringMethod, renderBmp } from "@/utils/render-bmp";
```

with:

```ts
import { packGrayscaleBmp } from "@/utils/render-bmp";
import { quantizeToPalette } from "@/utils/image-processing";
import { encodePng } from "@/utils/encode-png";
import {
	defaultGrayscaleProfile,
	type ResolvedRenderProfile,
} from "@/lib/trmnl/render-profile";
```

(After this task `recipe-renderer.ts` no longer calls `renderBmp`, so it is dropped from the import. The wrapper still lives in `render-bmp.ts` for the mixup/test-img callers.)

- [ ] **Step 2: Add `profile` to `RenderOptions`**

In the `RenderOptions` type (around line 245), keep `grayscale?: number;` and add below it:

```ts
	profile?: ResolvedRenderProfile; // palette-aware render profile; defaults to grayscale
```

- [ ] **Step 3: Rewrite the output section of `renderRecipeOutputs`**

Inside `renderRecipeOutputs`, replace the two blocks `if (needsPng) { ... }` and `if (needsBitmap) { ... }` (around lines 334-356) with:

```ts
		// Resolve the render profile (palette + method). Default to a grayscale
		// profile derived from the legacy `grayscale` level count.
		const profile: ResolvedRenderProfile =
			renderProfile ?? defaultGrayscaleProfile(grayscale ?? 2, needsPng && !needsBitmap ? "png" : "bmp");

		// Produce a single full-color RGB raster at the final dimensions, then
		// quantize once. Both PNG and BMP encode from that same dithered raster.
		let quantized: { data: Uint8Array; channels: 1 | 3 };
		try {
			let pipeline = sharp(pngBuffer);
			if (imageOptions.width !== imageWidth) {
				pipeline = pipeline.resize(imageWidth, imageHeight, {
					kernel: sharp.kernel.nearest,
				});
			}
			const { data: rgb } = await pipeline
				.resize(imageWidth, imageHeight, { fit: "fill" })
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });

			quantized = quantizeToPalette(new Uint8Array(rgb), imageWidth, imageHeight, profile, {
				applyEdgeSnap: config?.renderSettings?.applyEdgeSnap ?? true,
			});
		} catch (error) {
			logger.error(`Error quantizing ${slug}:`, error);
			return results;
		}

		if (needsPng) {
			try {
				results.png = await encodePng(
					quantized.data,
					imageWidth,
					imageHeight,
					quantized.channels,
				);
			} catch (error) {
				logger.error(`Error encoding PNG for ${slug}:`, error);
			}
		}

		if (needsBitmap) {
			if (quantized.channels === 1) {
				try {
					results.bitmap = packGrayscaleBmp(quantized.data, imageWidth, imageHeight, {
						grayscale: profile.levels,
					});
				} catch (error) {
					logger.error(`Error packing BMP for ${slug}:`, error);
				}
			} else {
				// Color palette requested as BMP: BMP is grayscale-only. Re-quantize
				// to a black/white grayscale profile so a .bmp URL always yields a
				// valid grayscale BMP. (Display route forces color palettes to PNG.)
				logger.warn(`BMP requested for color palette ${profile.paletteId}; falling back to grayscale BMP`);
				try {
					let pipeline = sharp(pngBuffer);
					if (imageOptions.width !== imageWidth) {
						pipeline = pipeline.resize(imageWidth, imageHeight, { kernel: sharp.kernel.nearest });
					}
					const { data: rgb } = await pipeline
						.resize(imageWidth, imageHeight, { fit: "fill" })
						.removeAlpha()
						.raw()
						.toBuffer({ resolveWithObject: true });
					const bwProfile = defaultGrayscaleProfile(2, "bmp");
					const { data: gray } = quantizeToPalette(new Uint8Array(rgb), imageWidth, imageHeight, bwProfile, {
						applyEdgeSnap: config?.renderSettings?.applyEdgeSnap ?? true,
					});
					results.bitmap = packGrayscaleBmp(gray, imageWidth, imageHeight, { grayscale: 2 });
				} catch (error) {
					logger.error(`Error packing fallback BMP for ${slug}:`, error);
				}
			}
		}
```

- [ ] **Step 4: Bind the `renderProfile` local from options**

In `renderRecipeOutputs`'s destructured params (around line 268-280), add `profile: renderProfile` to the destructuring:

```ts
	async ({
		slug,
		Component,
		props,
		config,
		imageWidth,
		imageHeight,
		formats = ["bitmap", "png"],
		grayscale,
		profile: renderProfile,
		html,
		cookies,
	}: RenderOptions): Promise<RenderResults> => {
```

- [ ] **Step 5: Thread `profile` through `renderRecipeToImage`**

In `renderRecipeToImage` (around line 472), add `profile` to the params type and both `renderRecipeOutputs(...)` calls:

```ts
export async function renderRecipeToImage({
	slug,
	imageWidth,
	imageHeight,
	formats = ["bitmap", "png"],
	grayscale,
	profile,
	userId,
	cookies,
}: {
	slug: string;
	imageWidth: number;
	imageHeight: number;
	formats?: RenderFormats;
	grayscale?: number;
	profile?: ResolvedRenderProfile;
	userId?: string | null;
	cookies?: string;
}): Promise<RenderResults> {
```

Then add `profile,` to both `renderRecipeOutputs({ ... })` calls inside that function (the `html` branch and the Component branch).

- [ ] **Step 6: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 7: Manual smoke render (grayscale regression)**

Run: `pnpm dev` in one shell. In another:
`curl -s "http://localhost:3000/api/bitmap/simple-text.bmp?width=800&height=480&grayscale=2" -o /tmp/a.bmp && file /tmp/a.bmp`
Expected: `PC bitmap ... 800 x 480 x 1`. Stop dev after.

- [ ] **Step 8: Commit**

```bash
git add lib/recipes/recipe-renderer.ts
git commit -m "feat: single palette-aware quantize pass for PNG + BMP outputs"
```

---

## Task 8: `resolveDeviceRenderProfile` (async, registry-backed)

**Files:**
- Modify: `lib/trmnl/device-profile.ts`

- [ ] **Step 1: Add the async resolver**

Append to `lib/trmnl/device-profile.ts`:

```ts
import { findPalette } from "./registry";
import {
	resolveRenderProfile,
	type DitheringMethodName,
	type ResolvedRenderProfile,
} from "./render-profile";

/**
 * Resolve a render profile for a device: look up the model (to pick a default
 * palette when none is set) and the palette, then build the IO-free profile.
 */
export async function resolveDeviceRenderProfile(opts: {
	model?: string | null;
	paletteId?: string | null;
	ditheringMethod?: DitheringMethodName | string | null;
	imageFormat?: "png" | "bmp";
}): Promise<ResolvedRenderProfile> {
	const { model, palette } = await getDeviceProfile(opts.model, opts.paletteId);
	const resolvedPalette = palette ?? (await findPalette(model.palette_ids[0] ?? "bw"));
	return resolveRenderProfile(resolvedPalette, {
		ditheringMethod: opts.ditheringMethod,
		imageFormat: opts.imageFormat,
	});
}

/** Resolve a profile from raw palette id + method (no model needed). */
export async function resolveProfileFromPalette(
	paletteId: string | null | undefined,
	ditheringMethod: DitheringMethodName | string | null | undefined,
	imageFormat: "png" | "bmp" | undefined,
): Promise<ResolvedRenderProfile> {
	const palette = paletteId ? await findPalette(paletteId) : null;
	return resolveRenderProfile(palette, { ditheringMethod, imageFormat });
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/trmnl/device-profile.ts
git commit -m "feat: async device render-profile resolution via registry"
```

---

## Task 9: `/api/models` route

**Files:**
- Create: `app/api/models/route.ts`

- [ ] **Step 1: Create the route (mirror of `/api/palettes`)**

Create `app/api/models/route.ts`:

```ts
import { getRegistry } from "@/lib/trmnl/registry";

/**
 * GET /api/models
 * List all TRMNL models (name, label, palette_ids, dimensions, …).
 * Served from the local 24h cache seeded by `data/trmnl/models.json`.
 */
export async function GET() {
	try {
		const data = await getRegistry("models");
		return Response.json(data);
	} catch (error) {
		return Response.json(
			{
				error: "Failed to load models registry",
				message: error instanceof Error ? error.message : "Unknown error",
			},
			{ status: 502 },
		);
	}
}
```

- [ ] **Step 2: Verify it responds**

Run: `pnpm dev`, then `curl -s http://localhost:3000/api/models | head -c 200`
Expected: JSON starting `{"data":[{"name":...}` including `inky_impression_7_3`. Stop dev.

- [ ] **Step 3: Commit**

```bash
git add app/api/models/route.ts
git commit -m "feat: /api/models registry route"
```

---

## Task 10: Bitmap route — accept `palette` & `dither` params

**Files:**
- Modify: `app/api/bitmap/[[...slug]]/route.ts`

- [ ] **Step 1: Parse the new params and resolve a profile**

In `app/api/bitmap/[[...slug]]/route.ts`, add the import at the top:

```ts
import { resolveProfileFromPalette } from "@/lib/trmnl/device-profile";
```

After the existing `grayscaleParam` parsing (around line 44), add:

```ts
		const paletteParam = searchParams.get("palette");
		const ditherParam = searchParams.get("dither");

		// Resolve a palette-aware profile. If `palette` is absent, fall back to a
		// grayscale profile derived from the legacy `grayscale` level count.
		const profile = paletteParam
			? await resolveProfileFromPalette(paletteParam, ditherParam, isPng ? "png" : "bmp")
			: undefined;
```

- [ ] **Step 2: Pass the profile into rendering**

Change the `renderRecipeImage` cached function (around line 94-116) to accept and forward `profile`. Replace its signature and body:

```ts
const renderRecipeImage = cache(
	async (
		recipeId: string,
		width: number,
		height: number,
		grayscaleLevels: number = 2,
		format: "bitmap" | "png" = "bitmap",
		userId: string | null = null,
		cookies?: string,
		profileKey?: string, // serialized profile for cache identity
	) => {
		const profile = profileKey
			? (JSON.parse(profileKey) as import("@/lib/trmnl/render-profile").ResolvedRenderProfile)
			: undefined;
		const renders = await renderRecipeToImage({
			slug: recipeId,
			imageWidth: width,
			imageHeight: height,
			formats: [format],
			grayscale: grayscaleLevels,
			profile,
			userId,
			cookies,
		});
		const buffer = format === "png" ? renders.png : renders.bitmap;
		return buffer ?? Buffer.from([]);
	},
);
```

- [ ] **Step 2b: Pass the serialized profile at the call site**

Update the `renderRecipeImage(...)` call (around line 58) to pass the serialized profile as the last argument:

```ts
			const recipeBuffer = await renderRecipeImage(
				recipeSlug,
				validWidth,
				validHeight,
				grayscaleLevels,
				isPng ? "png" : "bitmap",
				userId,
				cookieHeader || undefined,
				profile ? JSON.stringify(profile) : undefined,
			);
```

> Serializing the profile into the `cache()` key keeps React's per-request cache correct: different palettes/methods produce different keys.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Manual color render (the headline path)**

Run: `pnpm dev`, then:
`curl -s "http://localhost:3000/api/bitmap/simple-text.png?width=800&height=480&palette=color-7a&dither=floyd-steinberg" -o /tmp/c.png && file /tmp/c.png`
Expected: `PNG image data, 800 x 480, ... colormap` (indexed/paletted). Optionally inspect colors:
`node -e "const s=require('sharp');s('/tmp/c.png').stats().then(()=>s('/tmp/c.png').raw().toBuffer({resolveWithObject:true}).then(({data})=>{const set=new Set();for(let i=0;i<data.length;i+=3)set.add(data[i]+','+data[i+1]+','+data[i+2]);console.log('distinct colors:',set.size)}))"`
Expected: `distinct colors: <= 7`. Stop dev.

- [ ] **Step 5: Commit**

```bash
git add "app/api/bitmap/[[...slug]]/route.ts"
git commit -m "feat: bitmap route accepts palette & dither params"
```

---

## Task 11: Display route — emit palette/dither & pick format

**Files:**
- Modify: `app/api/display/route.ts`

- [ ] **Step 1: Resolve the device profile and build params**

In `app/api/display/route.ts`, add the import:

```ts
import { resolveDeviceRenderProfile } from "@/lib/trmnl/device-profile";
```

Replace the block that computes `grayscaleLevels`, `ext`, and `baseQueryParams` (around lines 110-117) with:

```ts
			const grayscaleLevels = getGrayscaleLevels(device.grayscale);

			// Resolve the device's palette-aware render profile. The palette (not
			// image_format) is the source of truth: color palettes force PNG.
			const profile = await resolveDeviceRenderProfile({
				model: device.model,
				paletteId: device.palette_id,
				ditheringMethod: device.dithering_method,
				imageFormat: device.image_format === "png" ? "png" : "bmp",
			});

			const ext = profile.format; // 'png' | 'bmp', already validated vs palette

			// `grayscale` kept as a deprecated alias for older cached URLs.
			const baseQueryParams = `width=${deviceWidth}&height=${deviceHeight}&palette=${encodeURIComponent(profile.paletteId)}&dither=${profile.ditheringMethod}&grayscale=${grayscaleLevels}${headers.base64 ? "&base64=true" : ""}`;
```

> The MIXUP branch keeps its hardcoded `.bmp` (out of scope per spec); a color palette on a mixup device therefore renders grayscale via the bitmap route's BMP fallback. Leave the MIXUP `imageUrl` line unchanged.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: error — `device.dithering_method` doesn't exist yet on the `Device` type. This is expected; it's added in Task 12. If you are running tasks strictly in order, do Task 12 now, then return to Step 3.

- [ ] **Step 3: Typecheck again (after Task 12)**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/api/display/route.ts
git commit -m "feat: display route resolves palette profile and output format"
```

---

## Task 12: DB migration, type, and save action

**Files:**
- Modify: `lib/database/sql-statements.ts` (add migration before `validate_schema`)
- Modify: `lib/types.ts` (`Device`)
- Modify: `lib/database/db.d.ts` (regenerated)
- Modify: `app/actions/device.ts`

- [ ] **Step 1: Add the migration + backfill**

In `lib/database/sql-statements.ts`, insert a new entry immediately before the `validate_schema:` key:

```ts
	"0016_add_device_dithering_method": {
		title: "Add Device Dithering Method",
		description:
			"Per-device dithering algorithm and palette-as-source-of-truth backfill.",
		sql: `-- Per-device dithering method: 'floyd-steinberg' (default) or 'none'.
ALTER TABLE devices
ADD COLUMN IF NOT EXISTS dithering_method TEXT NOT NULL DEFAULT 'floyd-steinberg';

COMMENT ON COLUMN devices.dithering_method IS 'Dithering algorithm applied when rendering to the device palette: ''floyd-steinberg'' (default) or ''none'' (flat nearest-color).';

-- Backfill palette_id from the legacy grayscale level count where unset.
UPDATE devices SET palette_id = CASE
	WHEN grayscale = 4 THEN 'gray-4'
	WHEN grayscale = 16 THEN 'gray-16'
	ELSE 'bw'
END
WHERE palette_id IS NULL;

-- Default model where unset so palette resolution has a model context.
UPDATE devices SET model = 'og_plus' WHERE model IS NULL;`,
	},
```

- [ ] **Step 2: Add the field to the `Device` type**

In `lib/types.ts`, in the `Device` type, after `palette_id: string | null;` add:

```ts
	dithering_method: string;
```

- [ ] **Step 3: Generate SQL + regenerate DB types**

Run: `pnpm generate:sql`
Expected: regenerates `migrations/*.sql` (a new `0016_*.sql` appears) and formats.

Run: `pnpm generate:types`
Expected: `lib/database/db.d.ts` now includes `dithering_method` on the `Devices` table. (Requires a reachable DB per `.env`. If unavailable, hand-edit `db.d.ts`: add `dithering_method: Generated<string>;` near `palette_id` in the `Devices` interface.)

- [ ] **Step 4: Persist the new fields in the update action**

In `app/actions/device.ts`, after the `image_format` block (around line 224), add:

```ts
	if (device.model !== undefined) updateData.model = device.model;
	if (device.palette_id !== undefined) updateData.palette_id = device.palette_id;
	if (device.dithering_method !== undefined)
		updateData.dithering_method = device.dithering_method;
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (this also unblocks Task 11's `device.dithering_method`).

- [ ] **Step 6: Commit**

```bash
git add lib/database/sql-statements.ts lib/types.ts lib/database/db.d.ts app/actions/device.ts migrations
git commit -m "feat: dithering_method column, palette backfill, persist model/palette/method"
```

---

## Task 13: Device edit form — model, palette & dithering controls

**Files:**
- Modify: `app/(app)/device/[friendly_id]/client-page.tsx` (fetch + pass registry data)
- Modify: `components/device/device-edit-form.tsx` (new controls; remove grayscale toggle)

- [ ] **Step 1: Fetch models & palettes in the client page**

In `app/(app)/device/[friendly_id]/client-page.tsx`, add state + effect inside the component (after the existing `useState` hooks):

```tsx
	const [availableModels, setAvailableModels] = useState<
		{ name: string; label: string; palette_ids: string[] }[]
	>([]);
	const [availablePalettes, setAvailablePalettes] = useState<
		{ id: string; name: string; colors?: string[] }[]
	>([]);

	useEffect(() => {
		let active = true;
		Promise.all([
			fetch("/api/models").then((r) => r.json()),
			fetch("/api/palettes").then((r) => r.json()),
		])
			.then(([models, palettes]) => {
				if (!active) return;
				setAvailableModels(models?.data ?? []);
				setAvailablePalettes(palettes?.data ?? []);
			})
			.catch(() => {
				/* registry optional; selectors degrade to empty lists */
			});
		return () => {
			active = false;
		};
	}, []);
```

Then pass them to the form (find `<DeviceEditForm` around line 453) by adding props:

```tsx
					availableModels={availableModels}
					availablePalettes={availablePalettes}
```

- [ ] **Step 2: Extend the form props + add controls**

In `components/device/device-edit-form.tsx`:

(a) Add to `DeviceEditFormProps`:

```ts
	availableModels: { name: string; label: string; palette_ids: string[] }[];
	availablePalettes: { id: string; name: string; colors?: string[] }[];
```

(b) Destructure them in the component signature alongside the other props:

```ts
	availableModels,
	availablePalettes,
```

(c) Inside the component body (after `const grayscaleLevels = ...`), compute the scoped palette list and selected palette:

```ts
	const selectedModel = availableModels.find((m) => m.name === editedDevice.model);
	const paletteIdsForModel = selectedModel?.palette_ids ?? [];
	const scopedPalettes = availablePalettes.filter((p) =>
		paletteIdsForModel.length ? paletteIdsForModel.includes(p.id) : true,
	);
	const selectedPalette = availablePalettes.find((p) => p.id === editedDevice.palette_id);
	const isColorPalette = !!selectedPalette?.colors?.length;
```

(d) Replace the **Grayscale levels** `<Field>...</Field>` block (around lines 517-534) with Model + Palette + Dithering controls:

```tsx
							<Field label="Model" hint="Selecting a model scopes the available palettes.">
								<Select
									value={editedDevice.model ?? ""}
									onValueChange={(value) => onSelectChange("model", value)}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Select model…" />
									</SelectTrigger>
									<SelectContent>
										{availableModels.map((m) => (
											<SelectItem key={m.name} value={m.name}>
												{m.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>

							<Field label="Palette" hint="Colors/levels the screen is dithered to.">
								<Select
									value={editedDevice.palette_id ?? ""}
									onValueChange={(value) => onSelectChange("palette_id", value)}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Select palette…" />
									</SelectTrigger>
									<SelectContent>
										{scopedPalettes.map((p) => (
											<SelectItem key={p.id} value={p.id}>
												<span className="flex items-center gap-2">
													{p.colors?.length ? (
														<span className="flex">
															{p.colors.slice(0, 8).map((c, i) => (
																<span
																	key={`${p.id}-${i}`}
																	className="h-3 w-3 rounded-[2px] border border-border/40"
																	style={{ backgroundColor: c }}
																/>
															))}
														</span>
													) : null}
													{p.name}
												</span>
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>

							<Field label="Dithering" hint="Floyd-Steinberg diffuses error for smoother gradients.">
								<ToggleGroup
									type="single"
									value={editedDevice.dithering_method ?? "floyd-steinberg"}
									onValueChange={(value) => {
										if (value) onSelectChange("dithering_method", value);
									}}
									variant="outline"
									className="grid w-fit grid-cols-2"
								>
									<ToggleGroupItem value="floyd-steinberg">Floyd-Steinberg</ToggleGroupItem>
									<ToggleGroupItem value="none">None</ToggleGroupItem>
								</ToggleGroup>
							</Field>
```

(e) The **Image format** field stays, but disable BMP for color palettes. Replace its `<ToggleGroup>` opening tag and the BMP item:

```tsx
									<ToggleGroup
										type="single"
										value={isColorPalette ? "png" : (editedDevice?.image_format ?? "bmp")}
										onValueChange={(value) => {
											if (value && !isColorPalette) onSelectChange("image_format", value);
										}}
										variant="outline"
										className="grid w-fit grid-cols-2"
									>
										<ToggleGroupItem value="bmp" disabled={isColorPalette}>
											BMP
										</ToggleGroupItem>
										<ToggleGroupItem value="png">PNG</ToggleGroupItem>
									</ToggleGroup>
```

(f) Update the live-preview `heroSrc` (around lines 135-137) to use palette + format. Replace those lines with:

```tsx
	const previewExt = isColorPalette ? "png" : (editedDevice?.image_format === "png" ? "png" : "bmp");
	const previewPalette = editedDevice.palette_id
		? `&palette=${encodeURIComponent(editedDevice.palette_id)}&dither=${editedDevice.dithering_method ?? "floyd-steinberg"}`
		: `&grayscale=${grayscaleLevels}`;
	const heroSrc = isMixup
		? `/api/bitmap/mixup/${editedDevice.mixup_id}.bmp?width=${deviceWidth}&height=${deviceHeight}&grayscale=${grayscaleLevels}`
		: `/api/bitmap/${editedDevice?.screen || "simple-text"}.${previewExt}?width=${deviceWidth}&height=${deviceHeight}${previewPalette}`;
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: no errors. (Biome may want import ordering — run `pnpm lint:fix` if it flags formatting.)

- [ ] **Step 4: Manual UI check**

Run: `pnpm dev`. Open a device's edit page. Verify:
- Model dropdown lists models; selecting **Inky Impression 7.3** scopes the Palette dropdown to `bw`, `color-7a`, `color-6a`.
- Selecting **color-7a** shows color swatches, disables the BMP toggle (forces PNG), and the live preview renders in the 7 colors.
- Selecting **None** dithering changes the preview to flat nearest-color.
- Save, reload, confirm the model/palette/method persisted.
Stop dev.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/device/[friendly_id]/client-page.tsx" components/device/device-edit-form.tsx
git commit -m "feat: device form model/palette/dithering controls; palette-driven preview"
```

---

## Task 14: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite**

Run: `pnpm test`
Expected: all tests pass (render-profile: 5, image-processing: 6).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm typecheck && pnpm lint`
Expected: clean.

- [ ] **Step 3: Grayscale BMP regression**

Run (dev server up): compare a `bw` render against the pre-change output if you stashed one; otherwise assert structural validity:
`curl -s "http://localhost:3000/api/bitmap/simple-text.bmp?width=800&height=480&palette=bw&dither=floyd-steinberg" -o /tmp/bw.bmp && file /tmp/bw.bmp`
Expected: `PC bitmap ... 800 x 480 x 1`.

- [ ] **Step 4: Inky color path**

`curl -s "http://localhost:3000/api/bitmap/simple-text.png?width=800&height=480&palette=color-7a&dither=floyd-steinberg" -o /tmp/inky.png && file /tmp/inky.png`
Expected: indexed PNG, ≤7 distinct colors (use the node one-liner from Task 10 Step 4).

- [ ] **Step 5: End-to-end display**

With a device set to Inky Impression 7.3 + color-7a, hit the display API the way firmware would:
`curl -s -H "Access-Token: <device api_key>" "http://localhost:3000/api/display" | grep -o '"image_url":"[^"]*"'`
Expected: an `image_url` ending in `.png` with `palette=color-7a&dither=floyd-steinberg`.

- [ ] **Step 6: Final commit (if any fixups)**

```bash
git add -A && git commit -m "chore: dithering & palettes verification fixups" || echo "nothing to commit"
```

---

## Self-Review Notes (for the implementer)

- **Task ordering caveat:** Task 2 imports `hexToRgb` from Task 3, and Task 11 needs the `Device.dithering_method` type from Task 12. Both cross-deps are called out inline with instructions to run the dependency first. If you use subagent-driven execution, dispatch in this order: 3 → 2 → 4 → 5 → 6 → 7 → 8 → 9 → 12 → 10 → 11 → 13 → 14.
- **Spec coverage:** migration+backfill (T12), resolver (T2/T8), color FS (T3), quantize dispatch (T4), PNG encoder + delete dead file (T5), BMP split (T6), single-raster pipeline (T7), `/api/models` (T9), bitmap params (T10), display route format/params (T11), UI model+palette+dither & grayscale removal (T13), mixup left grayscale (noted in T11), tests + manual checks (T2–T4, T14). All spec sections map to a task.
- **Type consistency:** `ResolvedRenderProfile`/`DitheringMethodName` defined once in `render-profile.ts`; `RGB`/`hexToRgb`/`nearestColorIndex`/`ditherFloydSteinbergColor`/`flatNearestColor`/`quantizeToPalette` in `image-processing.ts`; `packGrayscaleBmp`/`renderBmp` in `render-bmp.ts`; `encodePng` in `encode-png.ts`. Signatures referenced in later tasks match these definitions.
