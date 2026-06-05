import { PreSatori } from "@/utils/pre-satori";
import type { AdhdinosData } from "./getData";

export default function Adhdinos({
	imageUrl,
	title = "ADHDinos",
	width = 800,
	height = 480,
}: AdhdinosData & { width?: number; height?: number }) {
	return (
		<PreSatori width={width} height={height}>
			<div className="w-full h-full bg-white flex items-center justify-center p-2">
				{imageUrl ? (
					<picture>
						{/* Satori/Takumi do not support next/image — use a plain <img>. */}
						<source srcSet={imageUrl} />
						<img
							src={imageUrl}
							alt={title}
							width={width}
							height={height}
							className="w-full h-full object-contain"
						/>
					</picture>
				) : (
					<p className="text-3xl text-black">Error loading comic</p>
				)}
			</div>
		</PreSatori>
	);
}
