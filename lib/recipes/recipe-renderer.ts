import React, { cache, createElement } from "react";
import sharp from "sharp";
import NotFoundScreen from "@/app/(app)/recipes/screens/not-found/not-found";
import { getScreenParams } from "@/app/actions/screens-params";
import { db } from "@/lib/database/db";
import { withExplicitUserScope } from "@/lib/database/scoped-db";
import { checkDbConnection } from "@/lib/database/utils";
import { renderHtmlToImage } from "@/lib/recipes/html-screenshot";
import {
	customFieldsToParamDefinitions,
	fetchLiquidRecipeSettings,
	isLiquidRecipe,
	renderLiquidRecipe,
} from "@/lib/recipes/liquid-renderer";
import {
	defaultGrayscaleProfile,
	type ResolvedRenderProfile,
} from "@/lib/trmnl/render-profile";
import { encodePng } from "@/utils/encode-png";
import { quantizeToPalette } from "@/utils/image-processing";
import { packGrayscaleBmp } from "@/utils/render-bmp";
import { renderWithSatori } from "./renderers/satori";
import { renderWithTakumi } from "./renderers/takumi";

// Logging utility shared between recipe renderers
export const logger = {
	info: (message: string) => {
		if (process.env.NODE_ENV !== "production" || process.env.DEBUG === "true") {
			console.log(message);
		}
	},
	error: (message: string, error?: unknown) => {
		if (error) {
			console.error(message, error);
		} else {
			console.error(message);
		}
	},
	success: (message: string) => {
		if (process.env.NODE_ENV !== "production" || process.env.DEBUG === "true") {
			console.log(`✅ ${message}`);
		}
	},
	warn: (message: string, error?: unknown) => {
		if (process.env.NODE_ENV !== "production" || process.env.DEBUG === "true") {
			if (error) {
				console.warn(message, error);
			} else {
				console.warn(message);
			}
		}
	},
};

export type ComponentProps = Record<string, unknown> & {
	width?: number;
	height?: number;
};

export type RecipeParamType = "string" | "number" | "boolean";

export type RecipeParamDefinition = {
	label: string;
	type: RecipeParamType;
	description?: string;
	default?: unknown;
	placeholder?: string;
};

export type RecipeParamDefinitions = Record<string, RecipeParamDefinition>;

export type RecipeConfig = {
	title: string;
	published?: boolean;
	description?: string;
	componentPath?: string;
	hasDataFetch?: boolean;
	props?: Record<string, unknown>;
	params?: RecipeParamDefinitions;
	tags?: string[];
	renderSettings?: {
		doubleSizeForSharperText?: boolean;
		applyEdgeSnap?: boolean;
		/** Force a specific renderer for this recipe, overriding REACT_RENDERER. */
		renderer?: "takumi" | "satori" | "browser";
		/**
		 * For the browser renderer: navigate to this external URL and screenshot
		 * it instead of the recipe's internal preview page. The recipe's resolved
		 * params are appended as a kiosk query string (kiosk=1&hours=&theme=&w=&h=).
		 */
		url?: string;
		[key: string]: boolean | string | number | undefined;
	};
	[key: string]: unknown;
};

// Re-export constants from shared file
export { DEFAULT_IMAGE_HEIGHT, DEFAULT_IMAGE_WIDTH } from "./constants";

// Utility to check if we're in build phase
export const isBuildPhase = (): boolean =>
	process.env.NEXT_PHASE === "phase-production-build";

// Helper to add dimensions to props
export const addDimensionsToProps = (
	props: ComponentProps,
	width: number,
	height: number,
): ComponentProps => ({
	...props,
	width,
	height,
});

// Get renderer type from environment variable (defaults to "takumi")
export const getRendererType = (): "takumi" | "satori" | "browser" => {
	const renderer = process.env.REACT_RENDERER?.toLowerCase();
	if (renderer === "satori") return "satori";
	if (renderer === "browser") return "browser";
	return "takumi";
};

// Resolve the effective renderer for a recipe: a per-recipe override in
// renderSettings.renderer wins over the global REACT_RENDERER env.
const resolveRendererType = (
	config: RecipeConfig | null,
): "takumi" | "satori" | "browser" => {
	const override = config?.renderSettings?.renderer;
	if (
		override === "browser" ||
		override === "satori" ||
		override === "takumi"
	) {
		return override;
	}
	return getRendererType();
};

// Build the kiosk screenshot URL for a browser recipe that targets an external
// page (e.g. the AvianVisitors collage on the LAN). The recipe's resolved
// params become query args the page reads: ?kiosk=1&hours=&theme=&w=&h=.
const buildKioskUrl = (
	base: string,
	props: ComponentProps | undefined,
	width: number,
	height: number,
): string => {
	const url = new URL(base);
	url.searchParams.set("kiosk", "1");
	const params = (props?.params ?? {}) as Record<string, unknown>;
	for (const key of Object.keys(params)) {
		const value = params[key];
		if (value !== undefined && value !== null && value !== "") {
			url.searchParams.set(key, String(value));
		}
	}
	url.searchParams.set("w", String(width));
	url.searchParams.set("h", String(height));
	return url.toString();
};

export const fetchRecipeConfig = cache(
	async (slug: string, userId?: string): Promise<RecipeConfig | null> => {
		const { ready } = await checkDbConnection();
		if (!ready) return null;

		const runQuery = (conn: typeof db, sharedOnly = false) => {
			let query = conn
				.selectFrom("recipes")
				.select(["metadata"])
				.where("slug", "=", slug)
				.where("type", "=", "react");

			if (sharedOnly) {
				query = query.where("user_id", "is", null);
			}

			return query.executeTakeFirst();
		};

		const row = userId
			? await withExplicitUserScope(userId, runQuery)
			: await runQuery(db, true);

		if (!row?.metadata) return null;

		const config =
			typeof row.metadata === "string"
				? (JSON.parse(row.metadata) as RecipeConfig)
				: (row.metadata as unknown as RecipeConfig);

		if (!config.published && process.env.NODE_ENV === "production") {
			return null;
		}

		return config;
	},
);

export const fetchRecipeComponent = cache(async (slug: string) => {
	try {
		const { default: Component } = await import(
			`@/app/(app)/recipes/screens/${slug}/${slug}.tsx`
		);
		return Component;
	} catch (error) {
		logger.error(`Error loading component for ${slug}:`, error);
		return null;
	}
});

type FetchPropsOptions = {
	validateFetchedData?: (slug: string, data: unknown) => boolean;
};

export const fetchRecipeProps = cache(
	async (
		slug: string,
		config: RecipeConfig,
		options?: FetchPropsOptions,
		userId?: string,
	): Promise<ComponentProps> => {
		const params = config.params
			? await getScreenParams(slug, config.params, userId)
			: {};

		let props: ComponentProps = {
			...(config.props || {}),
			...(Object.keys(params).length > 0 ? { params } : {}),
		};

		if (isBuildPhase()) {
			return props;
		}

		if (!config.hasDataFetch) {
			return props;
		}

		try {
			const { default: fetchDataFunction } = (await import(
				`@/app/(app)/recipes/screens/${slug}/getData.ts`
			)) as {
				default: (params?: Record<string, unknown>) => Promise<ComponentProps>;
			};

			// Set a timeout for data fetching to prevent hanging
			const fetchPromise = fetchDataFunction(params);
			const timeoutPromise = new Promise((_, reject) => {
				setTimeout(() => reject(new Error("Data fetch timeout")), 10000);
			});

			// Race between the fetch and the timeout
			const fetchedData = await Promise.race([
				fetchPromise,
				timeoutPromise,
			]).catch((error) => {
				logger.error(`Data fetch error for ${slug}:`, error);
				return null;
			});

			// Validate fetched data when a validator is provided
			const isValid =
				fetchedData &&
				typeof fetchedData === "object" &&
				(!options?.validateFetchedData ||
					options.validateFetchedData(slug, fetchedData));

			if (isValid) {
				props = fetchedData as ComponentProps;
			} else {
				logger.warn(`Invalid or missing data for ${slug}`);
			}
		} catch (error) {
			logger.error(`Error fetching data for ${slug}:`, error);
		}

		return props;
	},
);

export const getRecipeImageOptions = (
	config: RecipeConfig | null,
	width: number,
	height: number,
) => {
	const useDoubling = config?.renderSettings?.doubleSizeForSharperText ?? false;
	const scaleFactor = useDoubling ? 2 : 1;

	return {
		width: width * scaleFactor,
		height: height * scaleFactor,
	};
};

type RenderFormats = Array<"bitmap" | "png">;

type RenderOptions = {
	slug: string;
	Component?: React.ComponentType<ComponentProps> | null;
	props?: ComponentProps;
	config: RecipeConfig | null;
	imageWidth: number;
	imageHeight: number;
	formats?: RenderFormats;
	grayscale?: number; // Number of gray levels: 2, 4, or 16
	profile?: ResolvedRenderProfile; // palette-aware render profile; defaults to grayscale
	html?: string; // When set, uses Puppeteer screenshot instead of Takumi/Satori
	cookies?: string; // Cookie header to forward to browser renderer
};

type RenderResults = {
	bitmap: Buffer | null;
	png: Buffer | null;
};

const getDefaultRenderResults = (): RenderResults => ({
	bitmap: null,
	png: null,
});

export const renderRecipeOutputs = cache(
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
		const results = getDefaultRenderResults();
		const needsPng = formats.includes("png");
		const needsBitmap = formats.includes("bitmap");

		if (!needsPng && !needsBitmap) return results;

		const imageOptions = getRecipeImageOptions(config, imageWidth, imageHeight);
		const rendererType = resolveRendererType(config);

		// Render PNG once and reuse it for png/bitmap outputs.
		let pngBuffer: Buffer;
		try {
			if (html) {
				pngBuffer = await renderHtmlToImage(
					html,
					imageOptions.width,
					imageOptions.height,
				);
			} else if (Component && props) {
				if (rendererType === "browser") {
					const { renderWithBrowser } = await import("./renderers/browser");
					const scaleFactor = imageOptions.width / imageWidth;
					const targetUrl = config?.renderSettings?.url
						? buildKioskUrl(
								config.renderSettings.url,
								props,
								imageWidth,
								imageHeight,
							)
						: undefined;
					pngBuffer = await renderWithBrowser(
						slug,
						imageWidth,
						imageHeight,
						scaleFactor,
						cookies,
						targetUrl,
					);
				} else {
					const element = createElement(Component, props);
					pngBuffer =
						rendererType === "satori"
							? await renderWithSatori(
									element,
									imageOptions.width,
									imageOptions.height,
								)
							: await renderWithTakumi(
									element,
									imageOptions.width,
									imageOptions.height,
								);
				}
			} else {
				logger.error(`No Component or html provided for ${slug}`);
				return results;
			}
		} catch (error) {
			logger.error(`Error generating PNG for ${slug}:`, error);
			return results;
		}

		// Resolve the render profile (palette + method). Default to a grayscale
		// profile derived from the legacy `grayscale` level count.
		const profile: ResolvedRenderProfile =
			renderProfile ??
			defaultGrayscaleProfile(
				grayscale ?? 2,
				needsPng && !needsBitmap ? "png" : "bmp",
			);

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

			quantized = quantizeToPalette(
				new Uint8Array(rgb),
				imageWidth,
				imageHeight,
				profile,
				{
					applyEdgeSnap: config?.renderSettings?.applyEdgeSnap ?? true,
				},
			);
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
					results.bitmap = packGrayscaleBmp(
						quantized.data,
						imageWidth,
						imageHeight,
						{
							grayscale: profile.levels,
						},
					);
				} catch (error) {
					logger.error(`Error packing BMP for ${slug}:`, error);
				}
			} else {
				// Color palette requested as BMP: BMP is grayscale-only. Re-quantize
				// to a black/white grayscale profile so a .bmp URL always yields a
				// valid grayscale BMP. (Display route forces color palettes to PNG.)
				logger.warn(
					`BMP requested for color palette ${profile.paletteId}; falling back to grayscale BMP`,
				);
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
					const bwProfile = defaultGrayscaleProfile(2, "bmp");
					const { data: gray } = quantizeToPalette(
						new Uint8Array(rgb),
						imageWidth,
						imageHeight,
						bwProfile,
						{
							applyEdgeSnap: config?.renderSettings?.applyEdgeSnap ?? true,
						},
					);
					results.bitmap = packGrayscaleBmp(gray, imageWidth, imageHeight, {
						grayscale: 2,
					});
				} catch (error) {
					logger.error(`Error packing fallback BMP for ${slug}:`, error);
				}
			}
		}

		return results;
	},
);

type BuildRecipeResult = {
	config: RecipeConfig | null;
	Component: React.ComponentType<ComponentProps> | null;
	props: ComponentProps;
	html?: string;
	element: React.ReactElement | null;
};

/**
 * Build a liquid recipe element by rendering the liquid template.
 */
async function buildLiquidRecipeElement(
	slug: string,
	userId?: string,
): Promise<BuildRecipeResult> {
	// Load stored custom field overrides from screen_configs
	let customFieldOverrides: Record<string, unknown> | undefined;
	const settings = await fetchLiquidRecipeSettings(slug, userId);
	if (settings?.custom_fields?.length) {
		const definitions = customFieldsToParamDefinitions(settings.custom_fields);
		customFieldOverrides = await getScreenParams(slug, definitions, userId);
	}

	const result = await renderLiquidRecipe(slug, customFieldOverrides, userId);

	if (!result) {
		return {
			config: null,
			Component: null,
			props: {},
			element: createElement(NotFoundScreen, { slug }),
		};
	}

	return {
		config: null,
		Component: null,
		props: {},
		html: result.html,
		element: null,
	};
}

export const buildRecipeElement = async ({
	slug,
	userId,
	validateProps,
}: {
	slug: string;
	userId?: string | null;
	validateProps?: (slug: string, props: ComponentProps) => boolean;
}): Promise<BuildRecipeResult> => {
	// First try React recipe from the DB metadata cache.
	const config = await fetchRecipeConfig(slug, userId ?? undefined);
	const Component = config ? await fetchRecipeComponent(slug) : null;

	if (config && Component) {
		const props = await fetchRecipeProps(
			slug,
			config,
			{
				validateFetchedData: validateProps
					? (recipeSlug: string, data: unknown) => {
							return (
								typeof data === "object" &&
								data !== null &&
								validateProps(recipeSlug, data as ComponentProps)
							);
						}
					: undefined,
			},
			userId ?? undefined,
		);

		if (validateProps && !validateProps(slug, props)) {
			return {
				config,
				Component: null,
				props,
				element: createElement(NotFoundScreen, { slug }),
			};
		}

		return {
			config,
			Component,
			props,
			element: createElement(Component, props),
		};
	}

	// Try liquid recipe from DB
	if (await isLiquidRecipe(slug, userId ?? undefined)) {
		return buildLiquidRecipeElement(slug, userId ?? undefined);
	}

	// Not found
	return {
		config: null,
		Component: null,
		props: {},
		element: createElement(NotFoundScreen, { slug }),
	};
};

/**
 * High-level helper: resolve a recipe (react or liquid) and render to image outputs.
 * Encapsulates buildRecipeElement + renderRecipeOutputs so API routes don't
 * need to branch on recipe type.
 */
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
	const result = await buildRecipeElement({ slug, userId });

	if (result.html) {
		return renderRecipeOutputs({
			slug,
			html: result.html,
			config: null,
			imageWidth,
			imageHeight,
			formats,
			grayscale,
			profile,
			cookies,
		});
	}

	const ComponentToRender = result.Component ?? (() => result.element);
	const propsWithDimensions = addDimensionsToProps(
		result.props,
		imageWidth,
		imageHeight,
	);

	return renderRecipeOutputs({
		slug,
		Component: ComponentToRender,
		props: propsWithDimensions,
		config: result.config,
		imageWidth,
		imageHeight,
		formats,
		grayscale,
		profile,
		cookies,
	});
}
