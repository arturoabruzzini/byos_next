export const dynamic = "force-dynamic";

import { unstable_cache } from "next/cache";

// ── Types ────────────────────────────────────────────────────────────────────

export type OpenMeteoHour = {
	time: string;
	temperature_2m: number;
	apparent_temperature: number;
	precipitation_probability: number;
	precipitation: number;
	weathercode: number;
	cloudcover: number;
	visibility: number;
	is_day: number;
	windspeed_10m: number;
	winddirection_10m: number;
};

export type OpenMeteoDay = {
	time: string;
	windspeed_10m_max: number;
	winddirection_10m_dominant: number;
	temperature_2m_max: number;
	temperature_2m_min: number;
	apparent_temperature_max: number;
	apparent_temperature_min: number;
};

export type MarineHour = {
	time: string;
	wave_height: number;
};

export type SeaLevelPoint = {
	sg: number;
	time: string;
};

export type AstronomicalDay = {
	astronomicalDawn: string | null;
	astronomicalDusk: string | null;
	civilDawn: string | null;
	civilDusk: string | null;
	moonFraction: number;
	moonPhase: { closest: { value: number }; current: { value: number } };
	moonrise: string;
	moonset: string;
	nauticalDawn: string | null;
	nauticalDusk: string | null;
	sunrise: string;
	sunset: string;
	time: string;
};

export type TidesData = {
	now: string;
	weather: OpenMeteoHour[];
	weatherDay: OpenMeteoDay;
	marine: MarineHour[];
	seaLevel: SeaLevelPoint[];
	astronomical: AstronomicalDay;
};

// ── Params ───────────────────────────────────────────────────────────────────

type TidesParams = {
	latitude?: number | string;
	longitude?: number | string;
	stormglass_api_key?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const isDateBetween = (d: Date, lo: Date, hi: Date) => lo <= d && d < hi;
const addHours = (d: Date, h: number) =>
	new Date(d.getTime() + h * 3_600_000);

// ── Open-Meteo fetch (15-min cache) ──────────────────────────────────────────

async function fetchOpenMeteo(lat: string, lng: string) {
	const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
	weatherUrl.searchParams.set("latitude", lat);
	weatherUrl.searchParams.set("longitude", lng);
	weatherUrl.searchParams.set(
		"hourly",
		"temperature_2m,apparent_temperature,precipitation_probability,precipitation,weathercode,cloudcover,visibility,is_day,windspeed_10m,winddirection_10m",
	);
	weatherUrl.searchParams.set(
		"daily",
		"windspeed_10m_max,winddirection_10m_dominant,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min",
	);
	weatherUrl.searchParams.set("windspeed_unit", "kn");
	weatherUrl.searchParams.set("timezone", "auto");
	weatherUrl.searchParams.set("forecast_days", "3");

	const marineUrl = new URL("https://marine-api.open-meteo.com/v1/marine");
	marineUrl.searchParams.set("latitude", lat);
	marineUrl.searchParams.set("longitude", lng);
	marineUrl.searchParams.set("hourly", "wave_height");
	marineUrl.searchParams.set("timezone", "auto");
	marineUrl.searchParams.set("forecast_days", "3");

	const [weatherRes, marineRes] = await Promise.all([
		fetch(weatherUrl.toString()),
		fetch(marineUrl.toString()),
	]);

	if (!weatherRes.ok) throw new Error(`Open-Meteo weather error ${weatherRes.status}`);
	if (!marineRes.ok) throw new Error(`Open-Meteo marine error ${marineRes.status}`);

	const rawWeather = await weatherRes.json();
	const rawMarine = await marineRes.json();

	// Zip parallel arrays into per-hour objects
	const weatherHourly: OpenMeteoHour[] = rawWeather.hourly.time.map(
		(time: string, i: number) => ({
			time,
			temperature_2m: rawWeather.hourly.temperature_2m[i],
			apparent_temperature: rawWeather.hourly.apparent_temperature[i],
			precipitation_probability: rawWeather.hourly.precipitation_probability[i],
			precipitation: rawWeather.hourly.precipitation[i],
			weathercode: rawWeather.hourly.weathercode[i],
			cloudcover: rawWeather.hourly.cloudcover[i],
			visibility: rawWeather.hourly.visibility[i],
			is_day: rawWeather.hourly.is_day[i],
			windspeed_10m: rawWeather.hourly.windspeed_10m[i],
			winddirection_10m: rawWeather.hourly.winddirection_10m[i],
		}),
	);

	const weatherDaily: OpenMeteoDay[] = rawWeather.daily.time.map(
		(time: string, i: number) => ({
			time,
			windspeed_10m_max: rawWeather.daily.windspeed_10m_max[i],
			winddirection_10m_dominant: rawWeather.daily.winddirection_10m_dominant[i],
			temperature_2m_max: rawWeather.daily.temperature_2m_max[i],
			temperature_2m_min: rawWeather.daily.temperature_2m_min[i],
			apparent_temperature_max: rawWeather.daily.apparent_temperature_max[i],
			apparent_temperature_min: rawWeather.daily.apparent_temperature_min[i],
		}),
	);

	const marineHourly: MarineHour[] = rawMarine.hourly.time.map(
		(time: string, i: number) => ({
			time,
			wave_height: rawMarine.hourly.wave_height[i],
		}),
	);

	return { weatherHourly, weatherDaily, marineHourly };
}

const getCachedOpenMeteo = (lat: string, lng: string) =>
	unstable_cache(() => fetchOpenMeteo(lat, lng), ["tides-openmeteo", lat, lng], {
		revalidate: 900, // 15 min
		tags: ["tides", "open-meteo"],
	})();

// ── Stormglass fetch (12-hour cache) ─────────────────────────────────────────

async function fetchStormglass(lat: string, lng: string, apiKey: string) {
	const headers = { Authorization: apiKey };
	const params = new URLSearchParams({ lat, lng, datum: "MLLW" });

	const [seaRes, astroRes] = await Promise.all([
		fetch(
			`https://api.stormglass.io/v2/tide/sea-level/point?${params}`,
			{ headers },
		),
		fetch(
			`https://api.stormglass.io/v2/astronomy/point?${new URLSearchParams({ lat, lng })}`,
			{ headers },
		),
	]);

	if (!seaRes.ok) throw new Error(`Stormglass sea-level error ${seaRes.status}`);
	if (!astroRes.ok) throw new Error(`Stormglass astronomy error ${astroRes.status}`);

	const seaJson = await seaRes.json();
	const astroJson = await astroRes.json();

	return {
		seaLevel: seaJson.data as SeaLevelPoint[],
		astronomical: astroJson.data as AstronomicalDay[],
	};
}

const getCachedStormglass = (lat: string, lng: string, apiKey: string) =>
	unstable_cache(
		() => fetchStormglass(lat, lng, apiKey),
		["tides-stormglass", lat, lng],
		{ revalidate: 43200, tags: ["tides", "stormglass"] }, // 12 h
	)();

// ── Filter helpers ────────────────────────────────────────────────────────────

function filterToWindow<T extends { time: string }>(
	items: T[],
	now: Date,
	hours = 24,
): T[] {
	const end = addHours(now, hours);
	return items.filter((x) => isDateBetween(new Date(x.time), now, end));
}

// ── Main export ───────────────────────────────────────────────────────────────

export default async function getData(
	params?: TidesParams,
): Promise<TidesData> {
	const lat = String(params?.latitude ?? "50.8171");
	const lng = String(params?.longitude ?? "-0.1189");
	const apiKey = params?.stormglass_api_key ?? "";

	const now = new Date();

	// Open-Meteo: always fetch (free)
	const { weatherHourly, weatherDaily, marineHourly } =
		await getCachedOpenMeteo(lat, lng);

	// Weather window: next 24 h
	const weather = filterToWindow(weatherHourly, now);

	// Daily entry covering the current day
	const weatherDay =
		weatherDaily.find((d) => {
			const end = addHours(now, 24);
			return isDateBetween(
				new Date(`${d.time}T23:00:00`),
				now,
				end,
			);
		}) ?? weatherDaily[0];

	// Marine window: next 24 h
	const marine = filterToWindow(marineHourly, now);

	// Stormglass: skip if no API key (recipe will render without tidal/astro data)
	let seaLevel: SeaLevelPoint[] = [];
	let astronomical: AstronomicalDay | null = null;

	if (apiKey) {
		const sg = await getCachedStormglass(lat, lng, apiKey);

		// Sea level: 24 h window + one point before and after for smooth curve
		const first = sg.seaLevel.findIndex((d) => new Date(d.time) > now);
		const last = sg.seaLevel.findIndex((d) => new Date(d.time) > addHours(now, 24));
		seaLevel = sg.seaLevel.slice(
			Math.max(0, first - 1),
			last === -1 ? undefined : last + 1,
		);

		// Astronomical: today's entry
		const todayKey = now.toISOString().replace(/T.*/, "T00:00:00+00:00");
		astronomical = sg.astronomical.find((d) => d.time === todayKey) ?? sg.astronomical[0] ?? null;
	}

	return {
		now: now.toISOString(),
		weather,
		weatherDay,
		marine,
		seaLevel,
		astronomical: astronomical as AstronomicalDay,
	};
}
