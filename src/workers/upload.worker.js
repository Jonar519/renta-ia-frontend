const MAX_SIZE_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg"];

self.onmessage = (event) => {
  const { name, size } = event.data;
  const ext = (name.split(".").pop() || "").toLowerCase();

  const errors = [];

  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    errors.push(`Tipo de archivo no permitido: .${ext}. Usa PDF, PNG o JPG.`);
  }

  if (size > MAX_SIZE_BYTES) {
    errors.push(`El archivo pesa ${(size / (1024 * 1024)).toFixed(1)} MB; el máximo permitido es 15 MB.`);
  }

  self.postMessage({ valid: errors.length === 0, errors });
};
