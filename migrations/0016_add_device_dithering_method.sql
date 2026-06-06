-- Title: Add Device Dithering Method
-- Description: Per-device dithering algorithm and palette-as-source-of-truth backfill.

-- Per-device dithering method: 'floyd-steinberg' (default) or 'none'.
ALTER TABLE devices
ADD COLUMN IF NOT EXISTS dithering_method TEXT NOT NULL DEFAULT 'floyd-steinberg';

COMMENT ON COLUMN devices.dithering_method IS 'Dithering algorithm applied when rendering to the device palette: ''floyd-steinberg'' (default) or ''none'' (flat nearest-color).';

-- Backfill palette_id from the legacy grayscale level count where unset.
UPDATE devices SET palette_id = CASE
	WHEN grayscale = 4 THEN 'gray-4'
	WHEN grayscale = 16 THEN 'gray-16'
	ELSE 'bw'
END
WHERE palette_id IS NULL;

-- Default model where unset so palette resolution has a model context.
UPDATE devices SET model = 'og_plus' WHERE model IS NULL;
