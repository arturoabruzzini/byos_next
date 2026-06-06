import type { NextRequest } from "next/server";
import { cache } from "react";
import NotFoundScreen from "@/app/(app)/recipes/screens/not-found/not-found";
import {
	DEFAULT_IMAGE_HEIGHT,
	DEFAULT_IMAGE_WIDTH,
	logger,
	renderRecipeOutputs,
	renderRecipeToImage,
} from "@/lib/recipes/recipe-renderer";
import { resolveProfileFromPalette } from "@/lib/trmnl/device-profile";
import {
	parseRequestHeaders,
	resolveUserIdFromApiKey,
} from "../../display/utils";

export async function GET(
	req: NextRequest,
	{ params }: { params: Promise<{ slug?: string[] }> },
) {
	const headers = parseRequestHeaders(req);
	try {
		// Always await params as required by Next.js 14/15
		const { slug = ["not-found"] } = await params;
		const bitmapPath = Array.isArray(slug) ? slug.join("/") : slug;
		// Format is driven by the file extension: ".png" → full-colour PNG,
		// anything else → the grayscale BMP path.
		const isPng = bitmapPath.toLowerCase().endsWith(".png");
		const recipeSlug = bitmapPath.replace(/\.(bmp|png)$/i, "");

		// Get width, height, and grayscale from query parameters
		const { searchParams } = new URL(req.url);
		const widthParam = searchParams.get("width");
		const heightParam = searchParams.get("height");
		const grayscaleParam = searchParams.get("grayscale");

		const width = widthParam ? parseInt(widthParam, 10) : DEFAULT_IMAGE_WIDTH;
		const height = heightParam
			? parseInt(heightParam, 10)
			: DEFAULT_IMAGE_HEIGHT;

		// Validate width and height are positive numbers
		const validWidth = width > 0 ? width : DEFAULT_IMAGE_WIDTH;
		const validHeight = height > 0 ? height : DEFAULT_IMAGE_HEIGHT;
		const grayscaleLevels = grayscaleParam ? parseInt(grayscaleParam, 10) : 2;

		const paletteParam = searchParams.get("palette");
		const ditherParam = searchParams.get("dither");

		// Resolve a palette-aware profile. If `palette` is absent, fall back to a
		// grayscale profile derived from the legacy `grayscale` level count.
		const profile = paletteParam
			? await resolveProfileFromPalette(
					paletteParam,
					ditherParam,
					isPng ? "png" : "bmp",
				)
			: undefined;

		logger.info(
			`Bitmap request for: ${bitmapPath} in ${validWidth}x${validHeight} with ${grayscaleLevels} gray levels`,
		);

		// Resolve the device owner so DB queries are scoped to the right user
		const userId = headers.apiKey
			? await resolveUserIdFromApiKey(headers.apiKey)
			: null;

		// Forward cookies so browser rendering can reuse the caller's auth session.
		const cookieHeader = req.headers.get("cookie");

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

		if (
			!recipeBuffer ||
			!(recipeBuffer instanceof Buffer) ||
			recipeBuffer.length === 0
		) {
			logger.warn(
				`Failed to generate ${isPng ? "png" : "bitmap"} for ${recipeSlug}, returning fallback`,
			);
			const fallback = await renderFallbackBitmap();
			return fallback;
		}

		return new Response(new Uint8Array(recipeBuffer), {
			headers: {
				"Content-Type": isPng ? "image/png" : "image/bmp",
				"Content-Length": recipeBuffer.length.toString(),
			},
		});
	} catch (error) {
		logger.error("Error generating image:", error);

		// Instead of returning an error, return the NotFoundScreen as a fallback
		return await renderFallbackBitmap("Error occurred");
	}
}

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
			? (JSON.parse(
					profileKey,
				) as import("@/lib/trmnl/render-profile").ResolvedRenderProfile)
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

const renderFallbackBitmap = cache(async (slug: string = "not-found") => {
	try {
		const renders = await renderRecipeOutputs({
			slug,
			Component: NotFoundScreen,
			props: { slug },
			config: null,
			imageWidth: DEFAULT_IMAGE_WIDTH,
			imageHeight: DEFAULT_IMAGE_HEIGHT,
			formats: ["bitmap"],
			grayscale: 2, // Default to 2 levels for fallback
		});

		if (!renders.bitmap) {
			throw new Error("Missing bitmap buffer for fallback");
		}

		return new Response(new Uint8Array(renders.bitmap), {
			headers: {
				"Content-Type": "image/bmp",
				"Content-Length": renders.bitmap.length.toString(),
			},
		});
	} catch (fallbackError) {
		logger.error("Error generating fallback image:", fallbackError);
		return new Response("Error generating image", {
			status: 500,
			headers: {
				"Content-Type": "text/plain",
			},
		});
	}
});
