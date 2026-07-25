// PNG export: single drawings and the C6 contact sheet. Strokes are vector
// data (normalised 0..1) re-rendered at export resolution — never bitmaps.

import { SEAT_COLORS } from "../../shared/palette";
import type { ArchiveEntry, Stroke } from "../../shared/types";
import { buildCurve } from "./curves";

function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.017;
  for (const stroke of strokes) {
    const curve = buildCurve(stroke.points, size);
    if (!curve) continue;
    ctx.strokeStyle = SEAT_COLORS[stroke.colorIndex] ?? "#121212";
    ctx.beginPath();
    ctx.moveTo(curve.x0, curve.y0);
    for (const s of curve.segs) {
      ctx.bezierCurveTo(s.c1x, s.c1y, s.c2x, s.c2y, s.x, s.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSize: number,
): void {
  ctx.fillStyle = "#121212";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#f2ede1";
  ctx.font = `700 ${fontSize}px Archivo, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(text.toUpperCase(), x + fontSize * 0.75, y + h / 2);
}

async function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/png");
  });
}

export async function drawingPng(strokes: Stroke[], caption: string): Promise<Blob> {
  const size = 1080;
  const bar = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size + bar;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fffbf0";
  ctx.fillRect(0, 0, size, size);
  drawStrokes(ctx, strokes, 0, 0, size);
  label(ctx, caption, 0, size, size, bar, 40);
  return toBlob(canvas);
}

export async function drawingReferencePng(strokes: Stroke[]): Promise<Blob> {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fffbf0";
  ctx.fillRect(0, 0, size, size);
  drawStrokes(ctx, strokes, 0, 0, size);
  return toBlob(canvas);
}

export async function contactSheetPng(archive: ArchiveEntry[], title: string): Promise<Blob> {
  const cell = 540;
  const gap = 24;
  const header = 160;
  const cols = 2;
  const rows = Math.max(1, Math.ceil(archive.length / cols));
  const width = cols * cell + (cols + 1) * gap;
  const height = header + rows * (cell + gap) + gap + 60;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#f2ede1";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#121212";
  ctx.font = `900 72px "Archivo Black", Archivo, sans-serif`;
  ctx.textBaseline = "top";
  ctx.fillText(title.toUpperCase(), gap, 36);
  ctx.fillRect(gap, 128, width - gap * 2, 6);

  archive.forEach((entry, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = gap + col * (cell + gap);
    const y = header + row * (cell + gap);
    ctx.fillStyle = "#fffbf0";
    ctx.fillRect(x, y, cell, cell);
    ctx.strokeStyle = "#121212";
    ctx.lineWidth = 4;
    ctx.strokeRect(x, y, cell, cell);
    drawStrokes(ctx, entry.strokes, x, y, cell);
    label(
      ctx,
      `${String(entry.roundNo).padStart(2, "0")} ${entry.word}`,
      x,
      y + cell - 44,
      cell,
      44,
      22,
    );
  });

  ctx.fillStyle = "#6b665c";
  ctx.font = "600 24px Archivo, sans-serif";
  ctx.fillText("THE UNINVITED PAINTER", gap, height - 48);
  return toBlob(canvas);
}

/** Publish a finished game to its permanent /a/:id page. Returns the full URL. */
export async function publishArchive(params: {
  title: string;
  players: { name: string; colorIndex: number; score: number }[];
  entries: ArchiveEntry[];
}): Promise<string> {
  const form = new FormData();
  form.append("meta", JSON.stringify(params));
  try {
    const png = await contactSheetPng(params.entries, params.title);
    form.append("image", new File([png], "archive.png", { type: "image/png" }));
  } catch {
    // No preview image is fine — the page itself renders from strokes.
  }
  const res = await fetch("/api/archives", { method: "POST", body: form });
  const data = (await res.json()) as { url?: string; error?: string };
  if (!res.ok || !data.url) throw new Error(data.error ?? "Publishing failed");
  return `${location.origin}${data.url}`;
}

export async function shareOrDownload(blob: Blob, filename: string): Promise<void> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return;
    } catch {
      // fall through to download (user may have cancelled — harmless)
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
