export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function scaledSize(width: number, height: number): { width: number; height: number } {
  const ratio = Math.min(1, MAX_EDGE / Math.max(width, height));
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) };
}

async function shrink(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const size = scaledSize(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) {
    return file;
  }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  return blob ? new File([blob], "fridge.jpg", { type: "image/jpeg" }) : file;
}

/**
 * Get a phone photo ready to upload: shrink it so it sends fast on venue Wi-Fi and stays under the limit.
 * Throws a message for the player when the file cannot be used.
 */
export async function preparePhoto(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) {
    throw new Error("That file is not a photo. Pick a JPEG, PNG, or WebP image.");
  }
  let prepared = file;
  try {
    prepared = await shrink(file);
  } catch {
    prepared = file;
  }
  if (!ACCEPTED_TYPES.has(prepared.type)) {
    throw new Error("This photo format is not supported. Use a JPEG, PNG, or WebP image.");
  }
  if (prepared.size > MAX_PHOTO_BYTES) {
    throw new Error("That photo is larger than 8 MB. Take it again a little farther back.");
  }
  return prepared;
}
