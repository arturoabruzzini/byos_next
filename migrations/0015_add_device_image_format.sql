-- Title: Add Device Image Format
-- Description: Per-device output format for the rendered screen. Mono e-ink
-- panels use 'bmp' (the existing 1/2/4-bpp grayscale BMP path). Full-color
-- panels (e.g. a 7-colour ACeP frame) use 'png', where the server serves the
-- renderer's native colour PNG and the device dithers to its own palette.

ALTER TABLE devices
ADD COLUMN IF NOT EXISTS image_format TEXT NOT NULL DEFAULT 'bmp';

COMMENT ON COLUMN devices.image_format IS 'Output image format the display API hands the device: ''bmp'' (grayscale, default) or ''png'' (full colour, dithered on-device). Controls the file extension in image_url and the bitmap route''s Content-Type.';
