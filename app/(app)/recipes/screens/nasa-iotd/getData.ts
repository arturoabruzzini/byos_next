import { fetchLatestFeedImage } from "@/utils/feed";

// Mark as dynamic so the recipe re-fetches the latest image on render.
export const dynamic = "force-dynamic";

const FEED_URL = "https://www.nasa.gov/feeds/iotd-feed/";

interface NasaParams {
	// "show" (default) or "hide" — whether to render the bottom title bar.
	show_title_bar?: string;
}

export interface NasaIotdData {
	imageUrl: string | null;
	title: string;
	showTitleBar: boolean;
}

/**
 * Fetch NASA's Image of the Day. The latest RSS item exposes the full-res
 * image via its <enclosure> tag.
 */
export default async function getData(
	params?: NasaParams,
): Promise<NasaIotdData> {
	const showTitleBar = params?.show_title_bar !== "hide";

	try {
		const { imageUrl, title } = await fetchLatestFeedImage(FEED_URL, {
			imageFrom: "enclosure",
			revalidate: 8 * 60 * 60, // refresh interval: 480 minutes
		});
		return { imageUrl, title: title || "", showTitleBar };
	} catch (error) {
		console.error("NASA IOTD feed fetch failed:", error);
		return { imageUrl: null, title: "", showTitleBar };
	}
}
