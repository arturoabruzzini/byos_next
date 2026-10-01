import {
	collapseWhitespace,
	decodeHtmlEntities,
	fetchText,
	stripHtmlTags,
} from "@/utils/feed";

// Mark as dynamic so the recipe re-fetches the latest picture on render.
export const dynamic = "force-dynamic";

// APOD moved from apod.nasa.gov to the NASA Science WordPress site (2026).
const BASE_URL = "https://science.nasa.gov/apod/";
const PAGE_URL = BASE_URL;

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
 * APOD only publishes an HTML page (the api.nasa.gov APOD API is broken since
 * the move, returning the NASA logo), so we scrape it:
 *  - the image is the first <img> in the hero "hds-media" block
 *  - the title is the first <h2> on the page
 *  - the explanation follows "Explanation:</strong>" up to the first <br>
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

		// The page is wrapped in the NASA Science site chrome (nav, news teasers),
		// so anchor on the first image served from the APOD asset folder. Its
		// src carries resize params (?w=1600&h=...), which we keep as-is.
		const imgMatch = html.match(
			/<img\b[^>]*\bsrc=["']([^"']*\/cds\/apod\/[^"']+)["']/i,
		);
		const imageUrl = imgMatch
			? new URL(decodeHtmlEntities(imgMatch[1]), BASE_URL).href
			: null;

		// The title is the last <h2> before the explanation (works on video
		// days too, where there is no APOD image to anchor on).
		const explIndex = html.search(/Explanation:\s*<\//i);
		const beforeExpl = explIndex >= 0 ? html.slice(0, explIndex) : "";
		const titles = [...beforeExpl.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)];
		const title = titles.length ? clean(titles[titles.length - 1][1]) : "";

		// The explanation is followed by <br>-separated site notices
		// ("APOD's main NASA site has moved", "Tomorrow's picture"), so stop there.
		const explMatch = html.match(
			/Explanation:\s*<\/(?:strong|b)>([\s\S]*?)(?:<br|<\/p>|Tomorrow's picture)/i,
		);
		const explanation = explMatch ? clean(explMatch[1]) : "";

		// e.g. "October 1, 2026", in the "Date" row of the meta table
		const dateMatch = html.match(
			/>\s*Date\s*<\/th>\s*<td[^>]*>\s*([\s\S]*?)<\/td>/i,
		);
		const date = dateMatch ? clean(dateMatch[1]) : "";

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
