import { PreSatori } from "@/utils/pre-satori";
import type { XkcdData } from "./getData";
import { BitmapText } from "@/components/bitmap-font/bitmap-text";
import fontData from "@/components/bitmap-font/bitmap-font.json";

export default function Xkcd({
  imageUrl,
  title = "",
  alt = "",
  showTitle = true,
  showAlt = true,
  width = 800,
  height = 480,
}: XkcdData & { width?: number; height?: number }) {
  return (
    <PreSatori width={width} height={height}>
      <div className="w-full h-full bg-white flex flex-col">
        {showTitle && title && (
          <div className="flex-none w-full text-center p-0 pt-4 text-2xl font-bold text-black">
            <BitmapText
              text={title}
              fontData={fontData}
              gridSize={`8x16`}
              scale={2}
              gap={1}
            />
          </div>
        )}
        <div className="flex-1 flex items-center justify-center p-2 min-h-0">
          {imageUrl ? (
            <picture>
              {/* Satori/Takumi do not support next/image — use a plain <img>. */}
              <source srcSet={imageUrl} />
              <img
                src={imageUrl}
                alt={alt || title}
                width={width}
                height={height}
                className="w-full h-full object-contain"
              />
            </picture>
          ) : (
            <p className="text-3xl text-black">Error loading comic</p>
          )}
        </div>
        {showAlt && alt && (
          <div className="flex-none w-full text-center font-inter p-1 text-lg text-black">
            {/* {alt} */}
            <BitmapText
              text={alt}
              fontData={fontData}
              gridSize={`7x8`}
              scale={1}
              gap={0}
            />
          </div>
        )}
      </div>
    </PreSatori>
  );
}
