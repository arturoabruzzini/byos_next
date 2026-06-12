import { PreSatori } from "@/utils/pre-satori";

interface BirdCollageProps {
	width?: number;
	height?: number;
	params?: {
		hours?: string;
		theme?: string;
	};
}

/**
 * Bird Collage.
 *
 * The real output is produced by the browser renderer screenshotting the
 * AvianVisitors kiosk page (see this recipe's `renderSettings.renderer:
 * "browser"` + `renderSettings.url` in screens.json). This component is only a
 * graceful fallback — shown in the gallery thumbnail, or if browser rendering
 * is unavailable — so a missing Chrome sidecar yields a readable message
 * instead of an error.
 */
export default function BirdCollage({
	width = 800,
	height = 480,
	params,
}: BirdCollageProps) {
	const hours = params?.hours ?? "1";
	return (
		<PreSatori width={width} height={height}>
			<div className="w-full h-full bg-white flex flex-col items-center justify-center gap-4">
				<span className="text-[48px] font-bold">Bird Collage</span>
				<span className="text-[24px]">
					Birds heard in the last {hours} hour{hours === "1" ? "" : "s"}
				</span>
				<span className="text-[18px]">
					Rendered from birdnet.local — needs the browser renderer.
				</span>
			</div>
		</PreSatori>
	);
}
