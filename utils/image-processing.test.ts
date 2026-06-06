import assert from "node:assert/strict";
import { test } from "node:test";
import type { ResolvedRenderProfile } from "@/lib/trmnl/render-profile";
import {
	ditherFloydSteinbergColor,
	flatNearestColor,
	hexToRgb,
	nearestColorIndex,
	quantizeToPalette,
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
	// Two mid-gray (128) pixels, B/W palette. Pixel 0 → white (127²·3 < 128²·3),
	// its -127 error pushes pixel 1 down to black.
	const rgb = new Uint8Array([128, 128, 128, 128, 128, 128]);
	const out = ditherFloydSteinbergColor(rgb, 2, 1, BW);
	assert.deepEqual([...out], [255, 255, 255, 0, 0, 0]);
});

test("flatNearestColor snaps each pixel to the nearest palette color", () => {
	const rgb = new Uint8Array([200, 200, 200, 30, 30, 30]);
	const out = flatNearestColor(rgb, BW);
	assert.deepEqual([...out], [255, 255, 255, 0, 0, 0]);
});

const colorProfile: ResolvedRenderProfile = {
	paletteId: "bwr",
	isColor: true,
	isContinuous: false,
	colors: [
		[0, 0, 0],
		[255, 255, 255],
	],
	levels: 2,
	bitDepth: 0,
	format: "png",
	ditheringMethod: "floyd-steinberg",
};
const grayProfile: ResolvedRenderProfile = {
	paletteId: "bw",
	isColor: false,
	isContinuous: false,
	colors: null,
	levels: 2,
	bitDepth: 1,
	format: "bmp",
	ditheringMethod: "floyd-steinberg",
};
const continuousProfile: ResolvedRenderProfile = {
	paletteId: "color-24bit",
	isColor: false,
	isContinuous: true,
	colors: null,
	levels: 2,
	bitDepth: 0,
	format: "png",
	ditheringMethod: "none",
};

test("quantizeToPalette: color path returns 3 channels", () => {
	const rgb = new Uint8Array([200, 200, 200, 30, 30, 30]);
	const { data, channels } = quantizeToPalette(rgb, 2, 1, colorProfile);
	assert.equal(channels, 3);
	assert.deepEqual([...data], [255, 255, 255, 0, 0, 0]);
});

test("quantizeToPalette: grayscale path returns 1 channel", () => {
	const rgb = new Uint8Array([200, 200, 200, 30, 30, 30]);
	const { data, channels } = quantizeToPalette(rgb, 2, 1, grayProfile, {
		applyEdgeSnap: false,
	});
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
