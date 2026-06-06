import fontData from "@/components/bitmap-font/bitmap-font.json";
import { BitmapText } from "@/components/bitmap-font/bitmap-text";
import { PreSatori } from "@/utils/pre-satori";
import type { NasaIotdData } from "./getData";

export default function NasaIotd({
	imageUrl,
	title = "",
	showTitleBar = true,
	width = 800,
	height = 480,
}: NasaIotdData & { width?: number; height?: number }) {
	return (
		<PreSatori width={width} height={height}>
			<div className="w-full h-full bg-white flex flex-col">
				<div className="flex-1 flex items-center justify-center p-2 min-h-0">
					{imageUrl ? (
						<picture>
							{/* Satori/Takumi do not support next/image — use a plain <img>. */}
							<source srcSet={imageUrl} />
							<img
								src={imageUrl}
								alt={title || "NASA Image of the Day"}
								width={width}
								height={height}
								className="w-full h-full object-contain"
							/>
						</picture>
					) : (
						<p className="text-3xl text-black">Error loading image</p>
					)}
				</div>
				{showTitleBar && (
					<div className="flex-none flex items-center gap-3 border-t-2 border-black px-3 py-2">
						<span className="text-2xl font-bold tracking-widest text-black">
							<BitmapText
								text={`NASA`}
								fontData={fontData}
								gridSize={`8x16`}
								scale={2}
								gap={0}
							/>
						</span>
						{title && (
							<span className="text-xl text-black font-inter truncate">
								<BitmapText
									text={title}
									fontData={fontData}
									gridSize={`7x8`}
									scale={1}
									gap={0}
								/>
							</span>
						)}
					</div>
				)}
			</div>
		</PreSatori>
	);
}
