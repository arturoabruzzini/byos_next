export const dynamic = "force-dynamic";

import { unstable_cache } from "next/cache";
import SunCalc from "suncalc";

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
};

// ── Astronomy (computed locally via SunCalc) ─────────────────────────────────

const isValidDate = (d: Date | undefined): d is Date =>
	d instanceof Date && !Number.isNaN(d.getTime());

function computeAstronomical(
	lat: number,
	lng: number,
	nowMs: number,
	offsetMs: number,
	toWallIso: (ms: number) => string,
): AstronomicalDay {
	const times = SunCalc.getTimes(new Date(nowMs), lat, lng);
	const moon = SunCalc.getMoonTimes(new Date(nowMs), lat, lng);
	const illum = SunCalc.getMoonIllumination(new Date(nowMs));

	const toWall = (d: Date | undefined): string | null => {
		if (!isValidDate(d)) return null;
		return toWallIso(d.getTime() + offsetMs);
	};

	const pickDate = (...dates: (Date | undefined)[]) =>
		dates.find(isValidDate);

	const moonrise = pickDate(moon.rise, moon.set, times.sunrise)!;
	const moonset = pickDate(moon.set, moon.rise, times.sunset)!;

	const todayKey = new Date(nowMs)
		.toISOString()
		.replace(/T.*/, "T00:00:00+00:00");

	const phase = illum.phase;

	const wallNowIso = toWallIso(nowMs + offsetMs);

	return {
		time: todayKey,
		sunrise: toWall(times.sunrise) ?? toWall(times.dawn) ?? wallNowIso,
		sunset: toWall(times.sunset) ?? toWall(times.dusk) ?? wallNowIso,
		civilDawn: toWall(times.dawn),
		civilDusk: toWall(times.dusk),
		nauticalDawn: toWall(times.nauticalDawn),
		nauticalDusk: toWall(times.nauticalDusk),
		astronomicalDawn: toWall(times.nightEnd),
		astronomicalDusk: toWall(times.night),
		moonrise: toWall(moonrise) ?? wallNowIso,
		moonset: toWall(moonset) ?? wallNowIso,
		moonFraction: illum.fraction,
		moonPhase: {
			closest: { value: phase },
			current: { value: phase },
		},
	};
}

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
	marineUrl.searchParams.set("hourly", "wave_height,sea_level_height_msl");
	marineUrl.searchParams.set("timezone", "auto");
	marineUrl.searchParams.set("forecast_days", "3");

	const [weatherRes, marineRes] = await Promise.all([
		fetch(weatherUrl.toString()),
		fetch(marineUrl.toString()),
	]);

	if (!weatherRes.ok)
		throw new Error(`Open-Meteo weather error ${weatherRes.status}`);
	if (!marineRes.ok)
		throw new Error(`Open-Meteo marine error ${marineRes.status}`);

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
			winddirection_10m_dominant:
				rawWeather.daily.winddirection_10m_dominant[i],
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

	const seaLevelHourly: SeaLevelPoint[] = (rawMarine.hourly.time as string[])
		.map((time: string, i: number) => ({
			time,
			sg: rawMarine.hourly.sea_level_height_msl?.[i] as number | undefined,
		}))
		.filter((d): d is SeaLevelPoint => d.sg != null);

	// utc_offset_seconds is returned by Open-Meteo when timezone=auto; it lets us
	// render in the location's local time regardless of the server's timezone.
	return {
		weatherHourly,
		weatherDaily,
		marineHourly,
		seaLevelHourly,
		utcOffsetSeconds: (rawWeather.utc_offset_seconds as number) ?? 0,
	};
}

const getCachedOpenMeteo = (lat: string, lng: string) =>
	unstable_cache(
		() => fetchOpenMeteo(lat, lng),
		["tides-openmeteo", "v2", lat, lng],
		{
			revalidate: 900, // 15 min
			tags: ["tides", "open-meteo"],
		},
	)();

// ── Main export ───────────────────────────────────────────────────────────────

export default async function getData(
	params?: TidesParams,
): Promise<TidesData> {
	const lat = String(params?.latitude ?? "50.8171");
	const lng = String(params?.longitude ?? "-0.1189");

	const {
		weatherHourly,
		weatherDaily,
		marineHourly,
		seaLevelHourly,
		utcOffsetSeconds,
	} = await getCachedOpenMeteo(lat, lng);

	// Render in the *location's* local time, not the server's. We express every
	// timestamp as the location's wall-clock time encoded as a UTC instant, and
	// the screen reads it back with getUTC* accessors. Open-Meteo hourly times are
	// offset-naive local strings (already wall clock → append "Z"); SunCalc times
	// are true UTC instants (shift by the offset to reach wall clock).
	const offsetMs = (utcOffsetSeconds ?? 0) * 1000;
	const wallFromNaive = (t: string) => new Date(`${t}Z`).getTime();
	const toWallIso = (ms: number) => new Date(ms).toISOString();

	const nowMs = Date.now();
	const wallNow = nowMs + offsetMs;
	const windowEnd = wallNow + 24 * 3_600_000;
	const inWindow = (ms: number) => wallNow <= ms && ms < windowEnd;

	// Weather window: next 24 h, re-stamped to wall-clock-as-UTC
	const weather: OpenMeteoHour[] = weatherHourly
		.filter((h) => inWindow(wallFromNaive(h.time)))
		.map((h) => ({ ...h, time: toWallIso(wallFromNaive(h.time)) }));

	// Daily entry covering the current day (its time field is unused for angles)
	const weatherDay =
		weatherDaily.find((d) => inWindow(wallFromNaive(`${d.time}T23:00:00`))) ??
		weatherDaily[0];

	// Marine window: next 24 h
	const marine: MarineHour[] = marineHourly
		.filter((h) => inWindow(wallFromNaive(h.time)))
		.map((h) => ({ ...h, time: toWallIso(wallFromNaive(h.time)) }));

	// Sea level: 24 h window + one point before and after for a smooth curve
	const seaLevels = seaLevelHourly ?? [];
	const first = seaLevels.findIndex((d) => wallFromNaive(d.time) > wallNow);
	const last = seaLevels.findIndex((d) => wallFromNaive(d.time) > windowEnd);
	const seaLevel = seaLevels
		.slice(Math.max(0, first - 1), last === -1 ? undefined : last + 1)
		.map((d) => ({ ...d, time: toWallIso(wallFromNaive(d.time)) }));

	const astronomical = computeAstronomical(
		Number(lat),
		Number(lng),
		nowMs,
		offsetMs,
		toWallIso,
	);

	return {
		now: toWallIso(wallNow),
		weather,
		weatherDay,
		marine,
		seaLevel,
		astronomical,
	};
}
