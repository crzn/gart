import { QUIZ_LIMITS } from "@gart/shared";
import { ApiError } from "./api";

/** Decodes the picked file, scales it down and re-encodes it (WebP, falling back to JPEG) under the size cap. */
export async function compressImage(file: File, maxSide = 1280): Promise<Blob> {
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new ApiError(0, "unsupported_image");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ApiError(0, "unsupported_image");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const encode = (type: string, q: number) => new Promise<Blob | null>((res) => canvas.toBlob(res, type, q));
  for (const type of ["image/webp", "image/jpeg"]) {
    for (const q of [0.85, 0.75, 0.65, 0.5, 0.35]) {
      const blob = await encode(type, q);
      if (blob && blob.type === type && blob.size <= QUIZ_LIMITS.imageMaxBytes) return blob;
    }
  }
  throw new ApiError(0, "image_too_large");
}

export async function uploadImage(file: File, maxSide?: number): Promise<string> {
  const blob = await compressImage(file, maxSide);
  const res = await fetch("/api/media", {
    method: "POST",
    credentials: "same-origin",
    headers: { "x-gart-csrf": "1", "Content-Type": blob.type },
    body: blob,
  });
  const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
  if (!res.ok || !data.id) throw new ApiError(res.status, data.error ?? "unknown");
  return data.id;
}

export const mediaUrl = (id: string): string => `/api/media/${encodeURIComponent(id)}`;
