import { fetchLatestFeedImage } from "@/utils/feed";

// Mark as dynamic so the recipe re-fetches the latest comic on render.
export const dynamic = "force-dynamic";

const FEED_URL = "https://comiccaster.xyz/feeds/adhdinos.xml";

export interface AdhdinosData {
	imageUrl: string | null;
	title: string;
}

/**
 * Fetch the latest ADHDinos comic. ComicCaster embeds the comic panels as
 * <img> tags inside the (HTML-encoded) item description. We pull the last one,
 * which is the summary panel that stitches all the others together.
 */
export default async function getData(): Promise<AdhdinosData> {
	try {
		const { imageUrl, title } = await fetchLatestFeedImage(FEED_URL, {
			imageFrom: "description-last-img",
			revalidate: 12 * 60 * 60, // refresh interval: 720 minutes
		});
		return { imageUrl, title: title || "ADHDinos" };
	} catch (error) {
		console.error("ADHDinos feed fetch failed:", error);
		return { imageUrl: null, title: "ADHDinos" };
	}
}
