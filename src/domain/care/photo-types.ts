export type PhotoKind = "jpeg" | "png" | "webp" | "heic";

const kinds: Record<string, PhotoKind> = {
  "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp",
  "image/heic": "heic", "image/heif": "heic", "image/heic-sequence": "heic", "image/heif-sequence": "heic",
};

// HEIC is accepted only as picker input. The picker re-encodes every photo to
// JPEG in the browser, so the server contract (JPEG/PNG/WebP) is unchanged.
export function photoKind(file: { type: string; name: string }): PhotoKind | null {
  const type = file.type.toLowerCase();
  if (Object.hasOwn(kinds, type)) return kinds[type];
  if (type === "" && /\.(heic|heif)$/i.test(file.name)) return "heic";
  return null;
}
