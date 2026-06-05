import { PreSatori } from "@/utils/pre-satori";
import type {
	AstronomicalDay,
	MarineHour,
	OpenMeteoDay,
	OpenMeteoHour,
	SeaLevelPoint,
} from "./getData";
import { ICON_PATHS } from "./icon-data";

// ── Colour palette ────────────────────────────────────────────────────────────

const C = {
	BLACK: "#000000",
	WHITE: "#ffffff",
	GREEN: "#00ff00",
	BLUE: "#0000ff",
	RED: "#ff0000",
	YELLOW: "#ffff00",
	ORANGE: "#ff8000",
} as const;

// ── Geometry helpers ──────────────────────────────────────────────────────────

const TAU = Math.PI * 2;

const getAngleFromTime = (t: Date) =>
	(t.getHours() / 24 +
		t.getMinutes() / (24 * 60) +
		t.getSeconds() / (24 * 60 * 60)) *
	TAU;

const getRelativeAngle = (t: Date, now: Date) =>
	TAU - getAngleFromTime(now) + getAngleFromTime(t);

// SVG arc convention: angles measured clockwise from 12 o'clock.
// Canvas: 0 = 3 o'clock, CCW in screen coords (y flipped).
// We map our "clock angle" θ → SVG angle = θ - π/2 so 0 is at top.
const toSvgAngle = (a: number) => a - Math.PI / 2;

const polar = (r: number, a: number): [number, number] => [
	r * Math.cos(toSvgAngle(a)),
	r * Math.sin(toSvgAngle(a)),
];

// Build a SVG arc path segment (large-arc handled automatically)
const arcPath = (
	cx: number,
	cy: number,
	r: number,
	startAngle: number,
	endAngle: number,
	sweep = 1,
) => {
	const [sx, sy] = polar(r, startAngle);
	const [ex, ey] = polar(r, endAngle);
	// Normalise to [0, TAU)
	let delta = ((endAngle - startAngle) % TAU + TAU) % TAU;
	const large = delta > Math.PI ? 1 : 0;
	return `M ${cx + sx} ${cy + sy} A ${r} ${r} 0 ${large} ${sweep} ${cx + ex} ${cy + ey}`;
};

// Pizza-slice filled arc (from centre)
const pizzaPath = (
	cx: number,
	cy: number,
	r: number,
	a1: number,
	a2: number,
) => {
	const [sx, sy] = polar(r, a1);
	const [ex, ey] = polar(r, a2);
	let delta = ((a2 - a1) % TAU + TAU) % TAU;
	const large = delta > Math.PI ? 1 : 0;
	return `M ${cx} ${cy} L ${cx + sx} ${cy + sy} A ${r} ${r} 0 ${large} 1 ${cx + ex} ${cy + ey} Z`;
};

// Cardinal spline → flat [x,y,x,y,...] interpolated points
const cardinalSpline = (pts: number[], tension = 0.5, segments = 16) => {
	if (pts.length < 4) return pts;
	const p = [pts[0], pts[1], ...pts, pts[pts.length - 2], pts[pts.length - 1]];
	const res: number[] = [];
	for (let i = 2; i < p.length - 4; i += 2) {
		for (let t = 0; t <= segments; t++) {
			const s = t / segments;
			const t1x = (p[i + 2] - p[i - 2]) * tension;
			const t2x = (p[i + 4] - p[i]) * tension;
			const t1y = (p[i + 3] - p[i - 1]) * tension;
			const t2y = (p[i + 5] - p[i + 1]) * tension;
			const c1 = 2 * s ** 3 - 3 * s ** 2 + 1;
			const c2 = -2 * s ** 3 + 3 * s ** 2;
			const c3 = s ** 3 - 2 * s ** 2 + s;
			const c4 = s ** 3 - s ** 2;
			res.push(
				c1 * p[i] + c2 * p[i + 2] + c3 * t1x + c4 * t2x,
				c1 * p[i + 1] + c2 * p[i + 3] + c3 * t1y + c4 * t2y,
			);
		}
	}
	return res;
};

const pointsToPath = (pts: number[]) =>
	pts.length < 2
		? ""
		: `M ${pts[0]} ${pts[1]} ` +
		  Array.from({ length: (pts.length - 2) / 2 }, (_, i) => i + 1)
				.map((i) => `L ${pts[i * 2]} ${pts[i * 2 + 1]}`)
				.join(" ");

// ── Polar curve ───────────────────────────────────────────────────────────────

function polarCurve(
	cx: number,
	cy: number,
	radius: number,
	now: Date,
	data: { time: string; value: number }[],
	min: number,
	max: number,
	color: string,
	strokeWidth = 2,
) {
	if (data.length < 2) return null;

	const toCart = (d: { time: string; value: number }): [number, number] => {
		const angle = getRelativeAngle(new Date(d.time), now);
		const len = (radius * (d.value - min)) / (max - min);
		const [x, y] = polar(len, angle);
		return [cx + x, cy + y];
	};

	const rawPts = data.map(toCart);

	// Interpolate first and last to the now-line (x = cx in centred coords)
	const yIntercept = (
		[x1, y1]: [number, number],
		[x2, y2]: [number, number],
	): [number, number] => {
		if (x2 === x1) return [cx, y1];
		const slope = (y2 - y1) / (x2 - x1);
		return [cx, y1 + slope * (cx - x1)];
	};

	rawPts[0] = yIntercept(rawPts[0], rawPts[1]);
	rawPts[rawPts.length - 1] = yIntercept(
		rawPts[rawPts.length - 1],
		rawPts[rawPts.length - 2],
	);

	const flat = rawPts.flat();
	const spline = cardinalSpline(flat);
	const d = pointsToPath(spline);

	return (
		<path
			d={d}
			fill="none"
			stroke={color}
			strokeWidth={strokeWidth}
			strokeLinecap="round"
		/>
	);
}

// ── Night-time zones ──────────────────────────────────────────────────────────

function NightTime({
	cx,
	cy,
	r,
	now,
	astro,
}: {
	cx: number;
	cy: number;
	r: number;
	now: Date;
	astro: AstronomicalDay;
}) {
	const a = (iso: string | null) =>
		iso ? getRelativeAngle(new Date(iso), now) : null;

	const sunset = a(astro.sunset);
	const sunrise = a(astro.sunrise);
	const civilDusk = a(astro.civilDusk);
	const civilDawn = a(astro.civilDawn);
	const nauticalDusk = a(astro.nauticalDusk);
	const nauticalDawn = a(astro.nauticalDawn);
	const astroDusk = a(astro.astronomicalDusk);
	const astroDawn = a(astro.astronomicalDawn);

	if (sunset === null || sunrise === null) return null;

	return (
		<g>
			<path d={pizzaPath(cx, cy, r, sunset, sunrise)} fill="#0000ff" />
			{civilDusk !== null && civilDawn !== null && (
				<path d={pizzaPath(cx, cy, r, civilDusk, civilDawn)} fill="#0000c0" />
			)}
			{nauticalDusk !== null && nauticalDawn !== null && (
				<path d={pizzaPath(cx, cy, r, nauticalDusk, nauticalDawn)} fill="#000080" />
			)}
			{astroDusk !== null && astroDawn !== null && (
				<path d={pizzaPath(cx, cy, r, astroDusk, astroDawn)} fill="#000040" />
			)}
		</g>
	);
}

// ── Moon arc ──────────────────────────────────────────────────────────────────

function MoonArc({
	cx,
	cy,
	r,
	now,
	astro,
}: {
	cx: number;
	cy: number;
	r: number;
	now: Date;
	astro: AstronomicalDay;
}) {
	const rise = getRelativeAngle(new Date(astro.moonrise), now);
	const set = getRelativeAngle(new Date(astro.moonset), now);
	const d = arcPath(cx, cy, r, rise, set);
	return (
		<g>
			<path d={d} fill="none" stroke={C.BLACK} strokeWidth={6} strokeLinecap="round" />
			<path d={d} fill="none" stroke={C.WHITE} strokeWidth={2} strokeLinecap="round" />
		</g>
	);
}

// ── Moon phase disc ───────────────────────────────────────────────────────────

function MoonPhase({
	x,
	y,
	phase,
}: {
	x: number;
	y: number;
	phase: number;
}) {
	// r=40 matches the original moonRadius=40 in drawMoon.ts
	// (x,y) is the centre of the disc
	const r = 40;
	const isWaxing = phase <= 0.5;
	// scale ∈ [-1, 1]: negative = dark side dominant (crescent), positive = lit side dominant (gibbous)
	const scale = isWaxing ? 4 * phase - 1 : 4 * (1 - phase) - 1;

	const shadowHalf = `M ${x} ${y - r} A ${r} ${r} 0 0 0 ${x} ${y + r} Z`;
	const rx = r * Math.abs(scale);
	const ellipseFill = scale > 0 ? C.WHITE : C.BLACK;
	const ellipseSweep = scale > 0 ? 0 : 1;
	const phasePath = `M ${x} ${y - r} A ${rx} ${r} 0 0 ${ellipseSweep} ${x} ${y + r} Z`;
	const transform = isWaxing ? "" : `rotate(180, ${x}, ${y})`;

	return (
		<g transform={transform}>
			<circle cx={x} cy={y} r={r} fill={C.WHITE} stroke={C.BLACK} strokeWidth={2} />
			<path d={shadowHalf} fill={C.BLACK} />
			<path d={phasePath} fill={ellipseFill} />
		</g>
	);
}

// ── Clock numbers (HTML overlay — SVG <text> not supported by Takumi/Satori) ──

function clockNumberDivs(cx: number, cy: number, r: number, now: Date) {
	const nowAngle = getAngleFromTime(now);
	const labels = [now.getHours() + 1, 0, 6, 12, 18];
	return labels.map((num) => {
		const angle = TAU - nowAngle + (num * Math.PI) / 12;
		const [dx, dy] = polar(r, angle);
		return (
			<div
				key={num}
				style={{
					position: "absolute",
					left: cx + dx,
					top: cy + dy,
					transform: "translate(-50%, -50%)",
					fontSize: 24,
					fontFamily: "Arial, sans-serif",
					color: C.BLACK,
					lineHeight: 1,
					pointerEvents: "none",
				}}
			>
				{num}
			</div>
		);
	});
}

// ── Weather conditions ────────────────────────────────────────────────────────

function WeatherConditions({
	cx,
	cy,
	r,
	now,
	weather,
}: {
	cx: number;
	cy: number;
	r: number;
	now: Date;
	weather: OpenMeteoHour[];
}) {
	// Sun rays: pizza slices from clock centre extending to canvas edge (matches original drawSunny)
	const sunPaths: { d: string; k: string }[] = [];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const icons: any[] = [];

	weather.forEach((hour) => {
		const angle = getRelativeAngle(new Date(hour.time), now);
		const code = hour.weathercode;
		const isDay = hour.is_day === 1;

		if (isDay && [0, 1, 2].includes(code)) {
			const rays = code === 2 ? 2 : 5;
			const totalAngle = Math.PI / 12;
			const rayWidth = totalAngle / 16;
			const raySpacing = totalAngle / rays;
			const minAngle = angle - Math.PI / 24;
			for (let i = 0; i < rays; i++) {
				const a1 = minAngle + i * raySpacing + raySpacing / 2;
				sunPaths.push({ d: pizzaPath(cx, cy, 800, a1, a1 + rayWidth), k: `${hour.time}-${i}` });
			}
		}

		// Cloud/precipitation icons at radius 201
		if (![0, 1].includes(code) || !isDay) {
			const [ix, iy] = polar(201, angle);
			const rot = (angle * 180) / Math.PI;
			icons.push(
				<g key={hour.time} transform={`translate(${cx + ix}, ${cy + iy}) rotate(${rot}) scale(2.5)`}>
					<WeatherIcon code={code} isDay={isDay} />
				</g>,
			);
		}
	});

	return (
		<g>
			{sunPaths.map(({ d, k }) => (
				<path key={k} d={d} fill={C.YELLOW} />
			))}
			{icons}
		</g>
	);
}

function WeatherIcon({ code, isDay }: { code: number; isDay: boolean }) {
	if (code === 2) {
		return <Cloud />;
	}

	// Overcast base
	const base = <Cloud />;

	if ([45, 48].includes(code)) return <g>{base}<Fog /></g>;
	if ([51, 56].includes(code)) return <g>{base}<Drizzle count={1} /></g>;
	if ([53].includes(code)) return <g>{base}<Drizzle count={2} /></g>;
	if ([55, 57].includes(code)) return <g>{base}<Drizzle count={3} /></g>;
	if ([61, 66].includes(code)) return <g>{base}<RainDrops count={1} /></g>;
	if ([63].includes(code)) return <g>{base}<RainDrops count={2} /></g>;
	if ([65, 67].includes(code)) return <g>{base}<RainDrops count={3} /></g>;
	if ([80].includes(code)) return <g>{base}<RainDrops count={1} /></g>;
	if ([81].includes(code)) return <g>{base}<RainDrops count={2} /></g>;
	if ([82].includes(code)) return <g>{base}<RainDrops count={3} /></g>;
	if ([71, 85].includes(code)) return <g>{base}<SnowFlake count={1} /></g>;
	if ([73].includes(code)) return <g>{base}<SnowFlake count={2} /></g>;
	if ([75, 77, 86].includes(code)) return <g>{base}<SnowFlake count={3} /></g>;
	if ([95, 96].includes(code)) return <g>{base}<RainDrops count={2} /><Lightning /></g>;
	if ([99].includes(code)) return <g>{base}<RainDrops count={3} /><Lightning /></g>;

	return base;
}

function Cloud() {
	return (
		<g>
			<rect x={-10} y={-2} width={20} height={7} rx={3} fill={C.WHITE} />
			<circle cx={-6} cy={-2} r={5} fill={C.WHITE} />
			<circle cx={4} cy={-4} r={4} fill={C.WHITE} />
		</g>
	);
}

function Fog() {
	return (
		<g stroke={C.WHITE} strokeWidth={2} strokeLinecap="round">
			<line x1={-8} y1={10} x2={8} y2={10} />
			<line x1={-6} y1={14} x2={6} y2={14} />
		</g>
	);
}

function RainDrops({ count }: { count: 1 | 2 | 3 }) {
	const xs = count === 1 ? [0] : count === 2 ? [-5, 5] : [-8, 0, 8];
	return (
		<g fill={C.BLUE}>
			{xs.map((x, i) => (
				<ellipse key={i} cx={x} cy={14 + (i % 2) * 4} rx={2.5} ry={4} />
			))}
		</g>
	);
}

function Drizzle({ count }: { count: 1 | 2 | 3 }) {
	const xs = count === 1 ? [0] : count === 2 ? [-4, 4] : [-7, 0, 7];
	return (
		<g stroke={C.BLUE} strokeWidth={2} strokeLinecap="round">
			{xs.map((x, i) => (
				<line key={i} x1={x} y1={10} x2={x - 2} y2={18} />
			))}
		</g>
	);
}

function SnowFlake({ count }: { count: 1 | 2 | 3 }) {
	const xs = count === 1 ? [0] : count === 2 ? [-5, 5] : [-8, 0, 8];
	return (
		<g stroke={C.WHITE} strokeWidth={2} strokeLinecap="round">
			{xs.map((x) =>
				Array.from({ length: 3 }, (_, i) => {
					const a = (i * Math.PI) / 3;
					return (
						<line
							key={i}
							x1={x + Math.cos(a) * 6}
							y1={14 + Math.sin(a) * 6}
							x2={x - Math.cos(a) * 6}
							y2={14 - Math.sin(a) * 6}
						/>
					);
				}),
			)}
		</g>
	);
}

function Lightning() {
	return (
		<polygon
			points="-2,8 -3,16 0,16 -2,24 5,12 2,12 4,8"
			fill={C.YELLOW}
		/>
	);
}

// ── Wind sock ─────────────────────────────────────────────────────────────────

function WindSock({
	cx,
	cy,
	speed,
	direction,
}: {
	cx: number;
	cy: number;
	speed: number;
	direction: number;
}) {
	const maxWidth = 60;
	const minWidth = 10;
	const speedIncrement = 5;
	const maxWindSpeed = 40;
	const maxSegments = Math.floor(maxWindSpeed / speedIncrement);
	const segLen = 50;

	const count = Math.min(Math.round(speed / speedIncrement), maxSegments);
	if (count === 0) return null;

	const widthStep = (maxWidth - minWidth) / maxSegments;

	const segments = Array.from({ length: count }, (_, i) => {
		const lw = (maxWidth - i * widthStep) / 2;
		const sw = (maxWidth - (i + 1) * widthStep) / 2;
		const y1 = segLen * i;
		const y2 = segLen * (i + 1);
		return (
			<polygon
				key={i}
				points={`${lw},${y1} ${-lw},${y1} ${-sw},${y2} ${sw},${y2}`}
				fill={i % 2 === 0 ? C.RED : C.WHITE}
			/>
		);
	});

	const offsetY = (-segLen * count) / 2;

	return (
		<g transform={`translate(${cx}, ${cy}) rotate(${direction}) translate(0, ${offsetY})`}>
			{segments}
		</g>
	);
}

// ── Clothing recommendation ───────────────────────────────────────────────────
// Positions match drawWeather.ts absolute canvas coords (after ctx.resetTransform())

function IconGroup({ name, tx, ty }: { name: string; tx: number; ty: number }) {
	const paths = ICON_PATHS[name];
	if (!paths) return null;
	return (
		<g transform={`translate(${tx}, ${ty})`}>
			{paths.map((p, i) => (
				<path key={i} fill={p.color} d={p.d} />
			))}
		</g>
	);
}

function ClothingIcon({ temp }: { temp: number }) {
	if (temp >= 30) {
		return <IconGroup name="underwear" tx={40} ty={340} />;
	}
	if (temp >= 25) {
		return (
			<g>
				<IconGroup name="vest" tx={16} ty={215} />
				<IconGroup name="shorts" tx={40} ty={340} />
			</g>
		);
	}
	if (temp >= 20) {
		return (
			<g>
				<IconGroup name="tshirt" tx={16} ty={215} />
				<IconGroup name="shorts" tx={40} ty={340} />
			</g>
		);
	}
	if (temp >= 18) {
		return (
			<g>
				<IconGroup name="tshirt" tx={16} ty={160} />
				<IconGroup name="trousers" tx={6} ty={300} />
			</g>
		);
	}
	if (temp >= 16) {
		return (
			<g>
				<IconGroup name="jumper" tx={6} ty={145} />
				<IconGroup name="trousers" tx={6} ty={300} />
			</g>
		);
	}
	if (temp >= 10) {
		return (
			<g>
				<IconGroup name="coat" tx={3} ty={140} />
				<IconGroup name="trousers" tx={6} ty={300} />
			</g>
		);
	}
	if (temp >= 0) {
		return (
			<g>
				<IconGroup name="hat" tx={50} ty={95} />
				<IconGroup name="winterCoat" tx={14} ty={165} />
				<IconGroup name="trousers" tx={6} ty={300} />
			</g>
		);
	}
	return <IconGroup name="snowman" tx={20} ty={280} />;
}

// ── Now line ──────────────────────────────────────────────────────────────────

function NowLine({ cx, cy, r }: { cx: number; cy: number; r: number }) {
	return (
		<line
			x1={cx}
			y1={cy}
			x2={cx}
			y2={cy - r}
			stroke={C.BLACK}
			strokeWidth={2}
		/>
	);
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface TidesProps {
	now?: string;
	weather?: OpenMeteoHour[];
	weatherDay?: OpenMeteoDay;
	marine?: MarineHour[];
	seaLevel?: SeaLevelPoint[];
	astronomical?: AstronomicalDay | null;
	width?: number;
	height?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Tides({
	now: nowStr,
	weather = [],
	weatherDay,
	marine = [],
	seaLevel = [],
	astronomical,
	width = 800,
	height = 480,
}: TidesProps) {
	const now = nowStr ? new Date(nowStr) : new Date();
	const cx = width / 2;
	const cy = height / 2;
	const maxR = height / 2;
	const innerR = maxR - 20; // filled circle clips night/weather

	return (
		<PreSatori width={width} height={height}>
			<div
				style={{
					width,
					height,
					background: C.ORANGE,
					position: "relative",
					overflow: "hidden",
				}}
			>
				<svg
					width={width}
					height={height}
					viewBox={`0 0 ${width} ${height}`}
					style={{ position: "absolute", inset: 0 }}
				>
					{/* Background orange circle */}
					<circle cx={cx} cy={cy} r={maxR} fill={C.ORANGE} />

					{/* Night time zones — original uses canvas.width (800) to fill whole bg */}
					{astronomical && (
						<NightTime cx={cx} cy={cy} r={width} now={now} astro={astronomical} />
					)}

					{/* Inner orange circle masks the very centre */}
					<circle cx={cx} cy={cy} r={innerR} fill={C.ORANGE} />

					{/* Moon visibility arc (outer ring) */}
					{astronomical && (
						<MoonArc cx={cx} cy={cy} r={maxR - 3} now={now} astro={astronomical} />
					)}

					{/* Weather icons wedges */}
					{weather.length > 0 && weatherDay && (
						<WeatherConditions cx={cx} cy={cy} r={innerR} now={now} weather={weather} />
					)}

					{/* Sea level polar curve (blue) — original passes maxRadius directly */}
					{seaLevel.length > 1 &&
						polarCurve(
							cx,
							cy,
							maxR,
							now,
							seaLevel.map((d) => ({ time: d.time, value: d.sg })),
							-1,
							6,
							C.BLUE,
						)}

					{/* Wave height polar curve (green) — original passes maxRadius directly */}
					{marine.length > 1 &&
						polarCurve(
							cx,
							cy,
							maxR,
							now,
							marine.map((d) => ({ time: d.time, value: d.wave_height })),
							0,
							3,
							C.GREEN,
						)}

					{/* Now line */}
					<NowLine cx={cx} cy={cy} r={maxR} />

					{/* Wind sock — centred at clock origin, matching original */}
					{weatherDay && (
						<WindSock
							cx={cx}
							cy={cy}
							speed={weatherDay.windspeed_10m_max}
							direction={weatherDay.winddirection_10m_dominant}
						/>
					)}

					{/* Clothing recommendation — absolute canvas positions from drawWeather.ts */}
					{weatherDay && (
						<ClothingIcon temp={weatherDay.apparent_temperature_max} />
					)}

					{/* Moon phase disc — absolute position (50,50) matching drawMoon.ts */}
					{astronomical && (
						<MoonPhase
							x={50}
							y={50}
							phase={astronomical.moonPhase.current.value}
						/>
					)}
				</svg>

				{/* Clock numbers as HTML — SVG <text> not rendered by Takumi/Satori */}
				{clockNumberDivs(cx, cy, innerR - 15, now)}
			</div>
		</PreSatori>
	);
}
