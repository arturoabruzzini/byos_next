# Per-Device Dithering & Palettes — Design

**Date:** 2026-06-06
**Status:** Approved (pending implementation plan)
**Headline target:** Inky Impression 7.3 (800×480, 7-color e-ink) rendering via the `color-7a` palette to a dithered color PNG.

## Problem

The user wants Floyd-Steinberg dithering that:

1. is **configurable per device**,
2. uses the **device's palette** (including color palettes, not just grayscale levels), and
3. applies to the **PNG output**, not only the BMP.

### Current state (from exploration)

- **Floyd-Steinberg already exists.** `utils/image-processing.ts` implements Floyd-Steinberg, Atkinson, Bayer, threshold, random, and `none`, all over 2/4/16 gray *levels*. It is already the default for BMP rendering.
- **The dithering method is hardcoded.** `lib/recipes/recipe-renderer.ts` always passes `DitheringMethod.FLOYD_STEINBERG`. There is no per-device control.
- **Palette is dead code.** `devices.palette_id` and `devices.model` columns exist (migrations `0011`), and `lib/trmnl/device-profile.ts#getDeviceProfile` resolves a model + palette from the registry — but nothing calls it. The device edit form has no model/palette selector, and the save action does not persist `palette_id`/`model`. Renderers quantize to N gray *levels*, never to a palette.
- **PNG is never dithered.** In `renderRecipeOutputs`, the PNG output is the raw full-color render from Takumi/Satori/browser, only resized. Only the BMP path runs dithering.
- **`utils/render-png.ts` is dead and buggy** — a hand-rolled 1-bit BMP→PNG converter that nothing calls and whose `deflate` callback never returns the buffer to the caller.
- **Palettes come in two kinds** (`data/trmnl/palettes.json`): grayscale (`bw`=2, `gray-4`=4, `gray-16`=16, `gray-256`=256) and color (`color-3bwr`, `color-3bwy`, `color-4bwry`, `color-6a`, `color-7a`, plus continuous `color-12bit`/`color-24bit`).
- **Inky Impression 7.3** is in the model registry (`inky_impression_7_3`, 800×480, `palette_ids: [bw, color-7a, color-6a]`). `color-7a` = black, white, red, green, blue, yellow, orange.

## Decisions

| Topic | Decision |
| --- | --- |
| Palette scope | Support color + grayscale **discrete** palettes. `color-12bit` / `color-24bit` (continuous) are full-color pass-through — no dithering. |
| Data model | `palette_id` (+ `model`) is the **source of truth** for colors/levels. The standalone per-device grayscale 2/4/16 toggle is removed from the UI (levels are derived from the palette). |
| Model & palette UI | Add a **Model** selector; the **Palette** selector is scoped to that model's `palette_ids`. Activates the dead `getDeviceProfile`/registry code. |
| Dithering control | Per device: **Floyd-Steinberg** (default) or **None**. Only Floyd-Steinberg is made color-aware now; the other algorithms remain code-/tool-only. |
| Output | PNG and BMP both derive from a **single** palette-quantized raster, so dithering necessarily applies to the PNG. Color palettes always emit PNG; BMP remains grayscale-only. |

## Architecture

Resolve one render profile from the device, run one palette-aware dithering pass, then encode whichever output formats are requested from that single raster.

```
device (model, palette_id, dithering_method, image_format)
        │
        ▼
getDeviceProfile ──► ResolvedRenderProfile
        │                { colors[], levels, isColor, isContinuous,
        │                  bitDepth, format, ditheringMethod }
        ▼
source render (Takumi/Satori/browser) ──► full-color PNG ──► resize
        │
        ▼
quantizeToPalette(rgb, w, h, profile) ──► dithered raster (snapped to palette)
        │
        ├──► PNG  : sharp(raster).png()      (indexed PNG for ≤256 colors)
        └──► BMP  : pack indices 1/2/4-bpp    (grayscale palettes only)
```

## Section 1 — Data model, migration & profile resolution

### New column
- Migration `0016_add_device_dithering_method` in `lib/database/sql-statements.ts`:
  - `ALTER TABLE devices ADD COLUMN IF NOT EXISTS dithering_method TEXT NOT NULL DEFAULT 'floyd-steinberg';`
  - Valid values: `'floyd-steinberg'`, `'none'`.
- Regenerate `lib/database/db.d.ts` (`pnpm generate:types`) and add `dithering_method: string` to the `Device` type in `lib/types.ts`.

### Repurposed columns
- `model`, `palette_id` — now the source of truth (previously dead).
- `grayscale` — retained in the DB for back-compat, no longer user-facing; derived from the palette at render time.
- `image_format` — retained but constrained by palette type (color ⇒ PNG).

### Backfill (in the same migration)
- `palette_id IS NULL` → from `grayscale`: `2→'bw'`, `4→'gray-4'`, `16→'gray-16'`, else `'bw'`.
- `model IS NULL` → `'og_plus'` (`DEFAULT_MODEL_NAME`).

### Resolved render profile
Extend `lib/trmnl/device-profile.ts` so `getDeviceProfile(model, palette_id)` also returns a normalized, render-ready object:

```ts
type ResolvedRenderProfile = {
  colors: string[] | null;   // hex list for color palettes; null for grayscale
  levels: number;            // grays count (2/4/16…) for grayscale palettes
  isColor: boolean;
  isContinuous: boolean;     // color-12bit / color-24bit → pass-through
  bitDepth: number;
  format: "png" | "bmp";     // validated against palette (color ⇒ png)
  ditheringMethod: "floyd-steinberg" | "none";
};
```

All resolution/validation lives here so the renderers stay dumb. Unknown palette → fall back to `bw` (mirrors the existing model fallback).

## Section 2 — Rendering core

### Color-aware Floyd-Steinberg (`utils/image-processing.ts`)
```ts
ditherFloydSteinbergColor(rgb: Uint8Array, width: number, height: number, palette: RGB[]): Uint8Array
```
- RGB input (3 bytes/pixel). For each pixel: find nearest palette color (squared Euclidean distance in RGB), write it out, diffuse per-channel error with standard FS weights (7/16, 3/16, 5/16, 1/16) into a working float buffer.
- `none` = nearest-color with no diffusion (flat quantize).
- Shared `nearestColor(rgb, palette)` helper.
- Existing grayscale functions are untouched.

### Unified quantize step
`quantizeToPalette(rgbBuffer, width, height, profile)` — single entry point the pipeline calls. Branches:
- **Continuous** (`color-12bit/24bit`): pass through, no dithering.
- **Color**: `ditherFloydSteinbergColor` (or flat nearest if method = `none`) → RGB raster.
- **Grayscale**: convert to gray, reuse existing `applyDithering` with `levels` from the profile → gray raster.

### Encoding — both outputs from the same raster
- **PNG**: encode the dithered raster with `sharp(...).png()`. For ≤256 distinct colors (all discrete palettes) sharp emits an indexed PNG with a PLTE of exactly the palette colors — ideal for the 7-color Inky. Grayscale palettes encode as gray PNG.
- **BMP**: grayscale palettes only — pack indices into 1/2/4-bpp rows as `renderBmp` does today. A color-palette + BMP request is rejected at profile resolution (format forced to PNG), so this branch only ever sees gray.

### `renderBmp` refactor (`utils/render-bmp.ts`)
- The dithering responsibility moves up into `quantizeToPalette`; the index-packing logic stays as the grayscale BMP encoder.
- Options take the resolved profile instead of a bare `grayscale` number, with a thin back-compat shim for the `grayscale` query param.

### Pipeline (`lib/recipes/recipe-renderer.ts`)
- After the source PNG is produced + resized, run `quantizeToPalette` **once**, then encode whichever of PNG/BMP were requested from that single raster.
- Replace the hardcoded `DitheringMethod.FLOYD_STEINBERG` with the profile's method.
- Thread `profile` through `renderRecipeToImage` / `renderRecipeOutputs` (replacing the bare `grayscale`).

### Cleanup
- Delete `utils/render-png.ts` (dead, buggy).

## Section 3 — Routes & UI

### Display route (`app/api/display/route.ts`)
- Resolve the device profile via `getDeviceProfile(device.model, device.palette_id)`.
- On the bitmap URL, replace `grayscale=N` with `palette=<id>&dither=<method>` (keep `grayscale` as a deprecated alias).
- Pick the extension from the **resolved** format (color palette ⇒ `.png`, overriding a stale `image_format`).
- No-DB fallback keeps `bw` / Floyd-Steinberg defaults.

### Bitmap route (`app/api/bitmap/[[...slug]]/route.ts`)
- Parse `palette` and `dither` query params, resolve into the same `ResolvedRenderProfile` (palette via registry).
- Pass `profile` through `renderRecipeToImage` → `renderRecipeOutputs` (signatures gain `profile`, replacing bare `grayscale`).
- `.png` vs `.bmp` extension still selects which buffer is returned.
- Cache key includes palette + method.

### New `/api/models` route
Mirrors the existing `/api/palettes` route so the device form can list models and their `palette_ids` client-side.

### Device edit form (`components/device/device-edit-form.tsx`) + save action (`app/actions/device.ts`)
- Add a **Model** `Select` (Display tab) populated from `/api/models`.
- Add a **Palette** `Select` scoped to the selected model's `palette_ids`, each option showing the palette name + color swatches (hex dots for color palettes).
- Add a **Dithering** toggle group: Floyd-Steinberg / None.
- **Remove** the standalone Grayscale-levels toggle (implied by palette).
- Image-format toggle stays but auto-switches to PNG (and disables BMP) when a color palette is selected.
- Save action persists `model`, `palette_id`, `dithering_method`; stops writing user-facing `grayscale`.
- Live-preview `heroSrc` switches from `grayscale=` to `palette=&dither=`, using `.png` for color palettes.

## Error handling

- Unknown/invalid palette → fall back to `bw`.
- Color palette + BMP → force PNG, log a warning.
- Continuous palette → skip dithering (pass-through).
- Empty/failed render → existing not-found BMP fallback, unchanged.

## Testing

No test runner exists in the repo today.

- **Unit tests** (Node's built-in `node:test`) for the new pure functions:
  - `nearestColor` — exact and tie-break cases.
  - `ditherFloydSteinbergColor` — a tiny hand-checked grid against a 2–3 color palette.
  - `quantizeToPalette` — branch selection (continuous / color / grayscale).
  - `getDeviceProfile` resolution + fallbacks (unknown palette → bw, color ⇒ png).
- **Manual verification checklist**:
  - Render a known image through `color-7a`; confirm the indexed PNG uses only the Inky's 7 colors.
  - Confirm a `bw` device still produces a byte-identical BMP to today (regression guard).

## Out of scope / YAGNI

- Making Atkinson / Bayer / threshold / random color-aware.
- Dithering the continuous `color-12bit` / `color-24bit` palettes.
- Per-recipe (as opposed to per-device) palette overrides.
- Changing the `image-ditherer` tool (it remains grayscale-only).
- **Mixup mode color output.** The display route hardcodes `.bmp` for `DeviceDisplayMode.MIXUP` (`mixup/<id>.bmp`), and `app/api/bitmap/mixup/[id]/route.ts` renders its own composite. Bringing color palettes to mixups requires the same `palette`/`dither` param plumbing there. For this iteration, mixup devices keep the grayscale BMP path; a color palette on a mixup device falls back to its grayscale rendering. Flagged as a follow-up, not silently broken.

## Affected files

- `lib/database/sql-statements.ts` (new migration + backfill)
- `lib/database/db.d.ts` (regenerated), `lib/types.ts` (`dithering_method`)
- `lib/trmnl/device-profile.ts` (`ResolvedRenderProfile`)
- `utils/image-processing.ts` (color FS + `nearestColor`)
- `utils/render-bmp.ts` (split: grayscale encoder vs dithering); `quantizeToPalette` lives in `utils/image-processing.ts` alongside the other dithering code
- `lib/recipes/recipe-renderer.ts` (pipeline, profile threading)
- `app/api/display/route.ts`, `app/api/bitmap/[[...slug]]/route.ts`
- `app/api/models/route.ts` (new)
- `components/device/device-edit-form.tsx`, `app/(app)/device/[friendly_id]/client-page.tsx`, `app/actions/device.ts`
- Delete `utils/render-png.ts`
