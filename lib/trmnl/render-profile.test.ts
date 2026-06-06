import assert from "node:assert/strict";
import { test } from "node:test";
import type { TrmnlPalette } from "./registry.ts";
import {
	defaultGrayscaleProfile,
	resolveRenderProfile,
} from "./render-profile.ts";

const colorSeven: TrmnlPalette = {
	id: "color-7a",
	name: "Color (7 colors)",
	grays: 2,
	colors: [
		"#000000",
		"#FFFFFF",
		"#FF0000",
		"#00FF00",
		"#0000FF",
		"#FFFF00",
		"#FFA500",
	],
};
const gray4: TrmnlPalette = { id: "gray-4", name: "4 Grays", grays: 4 };
const continuous: TrmnlPalette = {
	id: "color-24bit",
	name: "Color (16M)",
	grays: 2,
};

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
	assert.equal(
		resolveRenderProfile(gray4, { imageFormat: "png" }).format,
		"png",
	);
	assert.equal(resolveRenderProfile(gray4, {}).levels, 4);
	assert.equal(resolveRenderProfile(gray4, {}).bitDepth, 2);
});

test("continuous palette is pass-through png with no dithering", () => {
	const p = resolveRenderProfile(continuous, {
		ditheringMethod: "floyd-steinberg",
	});
	assert.equal(p.isContinuous, true);
	assert.equal(p.format, "png");
	assert.equal(p.ditheringMethod, "none");
});

test("dithering method defaults to floyd-steinberg, accepts none", () => {
	assert.equal(
		resolveRenderProfile(gray4, {}).ditheringMethod,
		"floyd-steinberg",
	);
	assert.equal(
		resolveRenderProfile(gray4, { ditheringMethod: "none" }).ditheringMethod,
		"none",
	);
});

test("defaultGrayscaleProfile(256) returns gray-256 paletteId and bitDepth 8", () => {
	const p = defaultGrayscaleProfile(256);
	assert.equal(p.paletteId, "gray-256");
	assert.equal(p.bitDepth, 8);
});

test("gray-256 palette resolves to 8-bpp png", () => {
	const p = resolveRenderProfile(
		{ id: "gray-256", name: "256 Grays", grays: 256 } as TrmnlPalette,
		{},
	);
	assert.equal(p.format, "png");
	assert.equal(p.bitDepth, 8);
	assert.equal(p.levels, 256);
});
