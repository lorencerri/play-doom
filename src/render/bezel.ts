import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { config } from '../config.ts';
import { fileExists } from '../http/serve.ts';

/**
 * The monitor bezel composited around frame images.
 *
 * `pad` can only draw flat bands, which is what the first attempt at this was: an 8px
 * rectangle that read as a border, not as a screen. A bezel needs rounded corners, a
 * gradient across the plastic, and — the part that actually sells it — an inner shadow
 * falling onto the picture, because that is what a recessed screen looks like.
 *
 * So it is drawn here as an SVG and overlaid by ffmpeg rather than padded. The image is
 * generated once per (size, thickness) and cached on disk: it is identical for every
 * frame of every namespace, and regenerating it per render would add a sharp raster to
 * a path measured in milliseconds.
 *
 * ## What it costs
 *
 * Measured on identical input: **442,505 bytes without, 554,262 with** — about +25% on
 * the README gif. Two attempts to claw that back mostly failed and are recorded here so
 * they are not retried: tightening the inner shadow (which falls across the picture)
 * saved 14.6KB, and quantising the bezel to 16 colours made it *worse*, 562KB, so the
 * cost is not palette competition as it first appeared. The remaining cost looks
 * inherent to the extra 24px on each axis and the shadow blending over picture content.
 *
 * It is still well under the 847KB the original app served, and `FRAME_BORDER=0` turns
 * it off, so this is a taste call rather than a problem to keep optimising.
 */

/**
 * doomgeneric's compile-time resolution — a 2x upscale of Doom's 320x200. Mirrored
 * here because the TypeScript side has to know the geometry to size the bezel, and the
 * C is the only side that otherwise knows it. If DOOMGENERIC_RESX/RESY ever change,
 * these must follow.
 */
export const NATIVE_WIDTH = 640;
export const NATIVE_HEIGHT = 400;

/** Inner picture size after any configured downscale. */
export function pictureSize(gifWidth: number): { width: number; height: number } {
	if (gifWidth <= 0) return { width: NATIVE_WIDTH, height: NATIVE_HEIGHT };

	// ffmpeg's `scale=W:-1` rounds the derived height to an even number.
	const height = Math.round((gifWidth * NATIVE_HEIGHT) / NATIVE_WIDTH / 2) * 2;
	return { width: gifWidth, height };
}

function bezelSvg(inner: { width: number; height: number }, border: number): string {
	const w = inner.width + border * 2;
	const h = inner.height + border * 2;

	// Corner radii scale with the bezel so a thin one does not look like a lozenge.
	const outerR = Math.max(4, Math.round(border * 0.9));
	const screenR = Math.max(2, Math.round(border * 0.4));

	// How far the shadow reaches onto the picture.
	//
	// Deliberately small, and this is a size decision as much as a visual one: the
	// shadow is the only part of the bezel that falls *across* the picture, so every
	// pixel under it becomes a new colour competing for the gif's 256-entry palette.
	// Measured at 0.7x the border it cost +126KB on a 442KB gif (+29%). Keeping it
	// tight preserves the recessed look for a fraction of that.
	const shadow = Math.max(2, Math.round(border * 0.3));

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
<defs>
  <linearGradient id="plastic" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#4c5158"/>
    <stop offset="0.45" stop-color="#2c2f34"/>
    <stop offset="1" stop-color="#191a1d"/>
  </linearGradient>
  <mask id="cutout">
    <rect width="${w}" height="${h}" fill="white"/>
    <rect x="${border}" y="${border}" width="${inner.width}" height="${inner.height}" rx="${screenR}" fill="black"/>
  </mask>
  <filter id="soften" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="${(shadow / 2.5).toFixed(2)}"/>
  </filter>
</defs>

<rect width="${w}" height="${h}" rx="${outerR}" fill="url(#plastic)" mask="url(#cutout)"/>

<rect x="${border}" y="${border}" width="${inner.width}" height="${inner.height}" rx="${screenR}"
      fill="none" stroke="#000000" stroke-opacity="0.6" stroke-width="${shadow * 2}" filter="url(#soften)"/>

<rect x="${border - 0.5}" y="${border - 0.5}" width="${inner.width + 1}" height="${inner.height + 1}" rx="${screenR}"
      fill="none" stroke="#0b0c0d" stroke-width="1"/>

<rect x="${outerR}" y="1" width="${w - outerR * 2}" height="1" fill="#ffffff" opacity="0.10"/>
<rect x="${outerR}" y="${h - 2}" width="${w - outerR * 2}" height="1" fill="#000000" opacity="0.35"/>
</svg>`;
}

/**
 * Writes the bezel for this configuration if it is not already on disk, and returns its
 * path. Returns undefined when the surround is switched off.
 *
 * The filename encodes the geometry, so changing `FRAME_BORDER` or `GIF_WIDTH` produces
 * a different file rather than serving a stale one sized for the old settings.
 */
export async function ensureBezel(gifWidth: number, border: number): Promise<string | undefined> {
	if (border <= 0) return undefined;

	const inner = pictureSize(gifWidth);
	const path = `${config.DATA_DIR}/bezel_${inner.width}x${inner.height}_${border}.png`;

	if (await fileExists(path)) return path;

	await mkdir(config.DATA_DIR, { recursive: true });
	await sharp(Buffer.from(bezelSvg(inner, border))).png().toFile(path);

	return path;
}

export { bezelSvg };

/**
 * The width every panel on the README is drawn at.
 *
 * This is the whole answer to the page looking like unrelated pieces: the frame, the
 * status card and the history strip were 658, 460 and however-wide-the-text-was. Equal
 * widths give them a shared edge, which is what makes a stack of images read as one
 * thing rather than three.
 */
export function panelWidth(): number {
	return pictureSize(config.GIF_WIDTH).width + config.FRAME_BORDER * 2;
}
