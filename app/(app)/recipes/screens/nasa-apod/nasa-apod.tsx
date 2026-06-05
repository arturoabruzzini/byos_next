import fontData from "@/components/bitmap-font/bitmap-font.json";
import { BitmapText } from "@/components/bitmap-font/bitmap-text";
import { PreSatori } from "@/utils/pre-satori";
import type { ApodData } from "./getData";

// Truncate to a sentence boundary near `max`, falling back to a hard cut.
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const boundary = text.lastIndexOf(". ", max);
  return boundary > max * 0.6
    ? text.slice(0, boundary + 1)
    : `${text.slice(0, max).trimEnd()}…`;
}

export default function NasaApod({
  imageUrl,
  title = "",
  explanation = "",
  date = "",
  showTitle = true,
  showExplanation = true,
  width = 800,
  height = 480,
}: ApodData & { width?: number; height?: number }) {
  const isHalf = width <= 400;
  const showText = showExplanation && !!explanation;
  const explanationMax = isHalf ? 220 : 640;

  return (
    <PreSatori width={width} height={height}>
      <div className="w-full h-full bg-white flex flex-col">
        <div className="flex-1 flex flex-row min-h-0">
          <div
            className={`${showText ? "w-1/2" : "w-full"} h-full flex items-center justify-center p-2`}
          >
            {imageUrl ? (
              <picture>
                {/* Satori/Takumi do not support next/image — use a plain <img>. */}
                <source srcSet={imageUrl} />
                <img
                  src={imageUrl}
                  alt={title || "Astronomy Picture of the Day"}
                  width={width}
                  height={height}
                  className="w-full h-full object-contain"
                />
              </picture>
            ) : (
              <p className="text-2xl text-black">Image unavailable</p>
            )}
          </div>
          {showText && (
            <div className="w-1/2 h-full flex flex-col p-3 border-l-2 border-black min-h-0">
              {showTitle && title && (
                <span className="text-2xl font-bold font-inter leading-tight text-black mb-2">
                  {title}
                </span>
              )}
              <span className="text-base font-inter leading-snug text-black">
                {truncate(explanation, explanationMax)}
              </span>
            </div>
          )}
        </div>
        <div className="flex-none flex items-center justify-between border-t-2 border-black px-3 py-2">
          <div className="flex items-center gap-3">
            <span className="text-2xl font-trakkie font-bold tracking-widest text-black">
              NASA
            </span>
            <span className="text-lg font-inter text-black truncate">
              {showText
                ? "Astronomy Picture of the Day"
                : title || "Astronomy Picture of the Day"}
            </span>
          </div>
          {date && (
            <span className="text-sm font-inter text-black">{date}</span>
          )}
        </div>
      </div>
    </PreSatori>
  );
}
