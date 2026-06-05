import { fetchJson } from "@/utils/feed";

// Mark as dynamic so the recipe re-fetches the latest comic on render.
export const dynamic = "force-dynamic";

const API_URL = "https://xkcd.com/info.0.json";

interface XkcdParams {
	// "show" (default) or "hide" for each.
	show_title?: string;
	show_alt?: string;
}

interface XkcdApiResponse {
	num: number;
	title: string;
	img: string;
	alt: string;
}

export interface XkcdData {
	imageUrl: string | null;
	title: string;
	alt: string;
	num: number | null;
	showTitle: boolean;
	showAlt: boolean;
}

/** Fetch the latest XKCD comic (image, title and hover/alt text). */
export default async function getData(params?: XkcdParams): Promise<XkcdData> {
	const showTitle = params?.show_title !== "hide";
	const showAlt = params?.show_alt !== "hide";

	try {
		const data = await fetchJson<XkcdApiResponse>(API_URL, {
			revalidate: 8 * 60 * 60, // refresh interval: 480 minutes
		});
		return {
			imageUrl: data.img || null,
			title: data.title || "",
			alt: data.alt || "",
			num: data.num ?? null,
			showTitle,
			showAlt,
		};
	} catch (error) {
		console.error("XKCD feed fetch failed:", error);
		return {
			imageUrl: null,
			title: "",
			alt: "",
			num: null,
			showTitle,
			showAlt,
		};
	}
}
