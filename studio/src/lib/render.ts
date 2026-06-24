import { Resvg } from "@resvg/resvg-js";
import sharp from "sharp";
import { FONT_DIR } from "./paths";

export interface RGBA {
  data: Buffer;
  width: number;
  height: number;
}

const FONT_OPT = { loadSystemFonts: false, fontDirs: [FONT_DIR] };

// renderTemplate: render an SVG at the output canvas width (the ONLY correct way for source/template SVGs).
export function renderTemplatePng(svg: string, outWidth: number, bg?: string): Buffer {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: outWidth }, font: FONT_OPT, background: bg } as any);
  return Buffer.from(r.render().asPng());
}

// renderNatural: NO fitTo scaling, 1 user unit = 1px. For small font-probe canvases inside calibrate.
export function renderNaturalPng(svg: string, bg?: string): Buffer {
  const r = new Resvg(svg, { fitTo: { mode: "original" }, font: FONT_OPT, background: bg } as any);
  return Buffer.from(r.render().asPng());
}

export async function pngToRGBA(png: Buffer, flattenBlack = false): Promise<RGBA> {
  let img = sharp(png);
  if (flattenBlack) img = img.flatten({ background: { r: 0, g: 0, b: 0 } });
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: data as Buffer, width: info.width, height: info.height };
}

export async function renderTemplateRGBA(svg: string, outWidth: number, flattenBlack = true): Promise<RGBA> {
  return pngToRGBA(renderTemplatePng(svg, outWidth, flattenBlack ? "#000000" : undefined), flattenBlack);
}

export async function renderNaturalRGBA(svg: string, flattenBlack = true): Promise<RGBA> {
  return pngToRGBA(renderNaturalPng(svg, flattenBlack ? "#000000" : undefined), flattenBlack);
}

export async function loadPngRGBA(filePath: string, flattenBlack = false): Promise<RGBA> {
  let img = sharp(filePath);
  if (flattenBlack) img = img.flatten({ background: { r: 0, g: 0, b: 0 } });
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: data as Buffer, width: info.width, height: info.height };
}

// Save an RGBA buffer to a PNG file.
export async function saveRGBA(img: RGBA, filePath: string): Promise<void> {
  await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 4 } }).png().toFile(filePath);
}
