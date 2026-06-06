import assert from "node:assert/strict";
import { test } from "node:test";
import {
	ditherFloydSteinbergColor,
	flatNearestColor,
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
