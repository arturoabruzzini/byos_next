import {
	collapseWhitespace,
	decodeHtmlEntities,
	fetchText,
	stripHtmlTags,
} from "@/utils/feed";

// Mark as dynamic so the recipe re-fetches the latest picture on render.
export const dynamic = "force-dynamic";

const BASE_URL = "https://apod.nasa.gov/apod/";
const PAGE_URL = `${BASE_URL}astropix.html`;

interface ApodParams {
	// "show" (default) or "hide" for each.
	show_title?: string;
	show_explanation?: string;
}

export interface ApodData {
	imageUrl: string | null;
	title: string;
	explanation: string;
	date: string;
	showTitle: boolean;
	showExplanation: boolean;
}

const clean = (html: string): string =>
	collapseWhitespace(decodeHtmlEntities(stripHtmlTags(html)));

/**
 * Fetch NASA's Astronomy Picture of the Day. Unlike the Image of the Day feed,
 * APOD only publishes an (old-school) HTML page, so we scrape it:
 *  - the image is the first <img>, with a path relative to the apod/ directory
 *  - the title is the first <b> on the page
 *  - the explanation sits between "Explanation:</b>" and the navigation footer
 *
 * On video days APOD embeds an <iframe> instead of an image; we still return
 * the title and explanation, with imageUrl left null.
 */
export default async function getData(params?: ApodParams): Promise<ApodData> {
	const showTitle = params?.show_title !== "hide";
	const showExplanation = params?.show_explanation !== "hide";

	try {
		const html = await fetchText(PAGE_URL, {
			revalidate: 8 * 60 * 60, // refresh interval: 480 minutes
		});

		const imgMatch = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
		const imageUrl = imgMatch ? new URL(imgMatch[1], BASE_URL).href : null;

		const titleMatch = html.match(/<b>\s*([\s\S]*?)<\/b>/i);
		const title = titleMatch ? clean(titleMatch[1]) : "";

		const explMatch = html.match(
			/Explanation:\s*<\/b>([\s\S]*?)(?:<p>\s*<center>|Tomorrow's picture|<hr)/i,
		);
		const explanation = explMatch ? clean(explMatch[1]) : "";

		// e.g. "2026 June 5"
		const dateMatch = html.match(/<p>\s*([0-9]{4}\s+[A-Z][a-z]+\s+[0-9]{1,2})/);
		const date = dateMatch ? dateMatch[1].trim() : "";

		return { imageUrl, title, explanation, date, showTitle, showExplanation };
	} catch (error) {
		console.error("NASA APOD fetch failed:", error);
		return {
			imageUrl: null,
			title: "",
			explanation: "",
			date: "",
			showTitle,
			showExplanation,
		};
	}
}
