// Shared helpers for "image-pulling" recipes — those that fetch a remote feed
// (RSS/Atom XML or JSON) and surface the latest image to display on the device.
//
// Deliberately dependency-free: the parsing is regex-based rather than pulling
// in a full XML parser, which is enough for the well-formed feeds these recipes
// consume (NASA Image of the Day, ComicCaster, etc.).

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_USER_AGENT = "trmnl-byos-nextjs (image recipe)";

export interface FetchOptions {
	timeoutMs?: number;
	headers?: Record<string, string>;
	// Forwarded to Next's fetch cache. 0 (default) disables caching.
	revalidate?: number;
}

/** Fetch a URL as text with a timeout and a sensible default User-Agent. */
export async function fetchText(
	url: string,
	options: FetchOptions = {},
): Promise<string> {
	const {
		timeoutMs = DEFAULT_TIMEOUT_MS,
		headers = {},
		revalidate = 0,
	} = options;

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const response = await fetch(url, {
			headers: { "User-Agent": DEFAULT_USER_AGENT, ...headers },
			signal: controller.signal,
			next: { revalidate },
		});

		if (!response.ok) {
			throw new Error(
				`Request to ${url} failed with status ${response.status}`,
			);
		}

		return await response.text();
	} finally {
		clearTimeout(timeout);
	}
}

/** Fetch and parse a JSON endpoint. */
export async function fetchJson<T>(
	url: string,
	options: FetchOptions = {},
): Promise<T> {
	const text = await fetchText(url, {
		...options,
		headers: { Accept: "application/json", ...options.headers },
	});
	return JSON.parse(text) as T;
}

/** Decode the HTML entities commonly found in RSS feeds. */
export function decodeHtmlEntities(input: string): string {
	return (
		input
			.replace(/&lt;/g, "<")
			.replace(/&gt;/g, ">")
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&#x27;/gi, "'")
			.replace(/&#0?39;/g, "'")
			.replace(/&nbsp;/g, " ")
			.replace(/&#(\d+);/g, (_, code: string) =>
				String.fromCharCode(Number(code)),
			)
			.replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
				String.fromCharCode(Number.parseInt(code, 16)),
			)
			// Decode &amp; last so we don't double-decode entities like &amp;lt;.
			.replace(/&amp;/g, "&")
	);
}

function stripCdata(value: string): string {
	const cdata = value.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
	return cdata ? cdata[1] : value;
}

/** Return the inner XML of the first <item> (RSS) or <entry> (Atom) element. */
export function firstFeedItem(xml: string): string | null {
	const match = xml.match(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/i);
	return match ? match[2] : null;
}

/** Read the text content of the first matching tag, unwrapping CDATA. */
export function tagText(xml: string, tag: string): string | null {
	const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i");
	const match = xml.match(re);
	return match ? stripCdata(match[1]).trim() : null;
}

/** Read the url attribute of the first <enclosure> (or <media:content>) tag. */
export function enclosureUrl(itemXml: string): string | null {
	const match = itemXml.match(
		/<(?:enclosure|media:content)\b[^>]*\burl=["']([^"']+)["']/i,
	);
	return match ? match[1] : null;
}

/** Read the src of the first <img> tag in an HTML fragment. */
export function firstImgSrc(html: string): string | null {
	const match = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i);
	return match ? match[1] : null;
}

/** Read the src of the last <img> tag in an HTML fragment. */
export function lastImgSrc(html: string): string | null {
	const matches = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)];
	return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

/** Strip all HTML tags from a fragment, keeping the inner text. */
export function stripHtmlTags(html: string): string {
	return html.replace(/<[^>]*>/g, "");
}

/** Collapse runs of whitespace (including newlines) into single spaces. */
export function collapseWhitespace(text: string): string {
	return text.replace(/\s+/g, " ").trim();
}

export interface LatestImage {
	imageUrl: string | null;
	title: string | null;
	link: string | null;
}

export interface LatestImageOptions extends FetchOptions {
	// How to locate the image within the latest feed item:
	//  - "enclosure": the <enclosure>/<media:content> url attribute (NASA, most feeds)
	//  - "description-img": the first <img> embedded in the (entity-encoded)
	//    description / content:encoded body (ComicCaster and similar)
	//  - "description-last-img": the last such <img> — useful for multi-panel
	//    comics whose final panel is a summary image containing all the others
	imageFrom?: "enclosure" | "description-img" | "description-last-img";
}

/**
 * Fetch an RSS/Atom feed and return the latest item's image, title and link.
 * Returns nulls (rather than throwing) when the feed has no items.
 */
export async function fetchLatestFeedImage(
	url: string,
	options: LatestImageOptions = {},
): Promise<LatestImage> {
	const { imageFrom = "enclosure", ...fetchOptions } = options;

	const xml = await fetchText(url, fetchOptions);
	const item = firstFeedItem(xml);
	if (!item) {
		return { imageUrl: null, title: null, link: null };
	}

	const rawTitle = tagText(item, "title");
	const title = rawTitle ? decodeHtmlEntities(rawTitle) : null;
	const link = tagText(item, "link");

	let imageUrl: string | null = null;
	if (imageFrom === "enclosure") {
		imageUrl = enclosureUrl(item);
	} else {
		const body =
			tagText(item, "content:encoded") ?? tagText(item, "description") ?? "";
		const html = decodeHtmlEntities(body);
		imageUrl =
			imageFrom === "description-last-img"
				? lastImgSrc(html)
				: firstImgSrc(html);
	}

	return { imageUrl, title, link };
}
