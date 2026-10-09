/**
 * Recorte y reducción de la foto de perfil en el navegador (B12), con canvas
 * nativo: cuadrado de 256×256, exportado a JPEG. Volver a codificar la
 * imagen también descarta los metadatos del archivo original (EXIF, como la
 * ubicación GPS de una foto de celular).
 *
 * Se encuadra arrastrando o con las flechas (Mayús = pasos largos) y se
 * acerca con el control "Zoom". La vista previa es el mismo canvas que se
 * exporta. Sin animaciones.
 *
 * @returns {Promise<Blob | null>} la imagen recortada, o null si se cancela
 */
export const SIZE = 256;
export const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MIN_SIDE = 64;

export async function cropAvatar(host, file) {
  if (!["image/png", "image/jpeg"].includes(file.type)) throw new Error("Elige una imagen PNG o JPG.");
  if (file.size > MAX_SOURCE_BYTES) throw new Error("La imagen supera 10 MB. Elige una más liviana.");
  const source = URL.createObjectURL(file);
  const img = new Image();
  img.src = source;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(source);
    throw new Error("No se pudo leer la imagen. Elige otra.");
  }
  if (Math.min(img.naturalWidth, img.naturalHeight) < MIN_SIDE) {
    URL.revokeObjectURL(source);
    throw new Error(`La imagen es muy pequeña (mínimo ${MIN_SIDE}×${MIN_SIDE} píxeles).`);
  }

  host.innerHTML = `
    <div class="avatar-cropper">
      <canvas width="${SIZE}" height="${SIZE}" tabindex="0" role="img" aria-label="Vista previa de la foto recortada" aria-describedby="avatar-crop-help"></canvas>
      <div>
        <p class="form-hint" id="avatar-crop-help">Arrastra la foto o usa las flechas para encuadrarla.</p>
        <label class="avatar-cropper__zoom">Zoom <input type="range" min="1" max="3" step="0.05" value="1" /></label>
        <div class="form-actions">
          <button type="button" class="btn btn--ghost" data-crop="cancel">Cancelar</button>
          <button type="button" class="btn btn--primary" data-crop="save">Guardar foto</button>
        </div>
      </div>
    </div>`;
  const canvas = host.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const zoom = host.querySelector("input[type=range]");
  const base = Math.max(SIZE / img.naturalWidth, SIZE / img.naturalHeight); // la foto siempre cubre el cuadrado
  let scale = base;
  let x = (SIZE - img.naturalWidth * scale) / 2;
  let y = (SIZE - img.naturalHeight * scale) / 2;

  function draw() {
    // Sin huecos: el borde de la foto nunca entra en el cuadrado.
    x = Math.min(0, Math.max(SIZE - img.naturalWidth * scale, x));
    y = Math.min(0, Math.max(SIZE - img.naturalHeight * scale, y));
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.drawImage(img, x, y, img.naturalWidth * scale, img.naturalHeight * scale);
  }
  draw();

  zoom.addEventListener("input", () => {
    // Acercar sobre el centro de la vista previa.
    const next = base * Number(zoom.value);
    x = SIZE / 2 - ((SIZE / 2 - x) * next) / scale;
    y = SIZE / 2 - ((SIZE / 2 - y) * next) / scale;
    scale = next;
    draw();
  });

  let drag = null;
  canvas.addEventListener("pointerdown", (event) => {
    drag = { px: event.clientX, py: event.clientY, x, y };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag) return;
    // Pantalla → píxeles del canvas (puede verse más chico que 256 en móvil).
    const ratio = SIZE / canvas.getBoundingClientRect().width;
    x = drag.x + (event.clientX - drag.px) * ratio;
    y = drag.y + (event.clientY - drag.py) * ratio;
    draw();
  });
  canvas.addEventListener("pointerup", () => (drag = null));
  canvas.addEventListener("keydown", (event) => {
    const step = event.shiftKey ? 32 : 8;
    const moves = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    x += move[0];
    y += move[1];
    draw();
  });
  canvas.focus();

  return new Promise((resolve) => {
    const finish = (blob) => {
      URL.revokeObjectURL(source);
      host.innerHTML = "";
      resolve(blob);
    };
    host.querySelector("[data-crop=cancel]").addEventListener("click", () => finish(null));
    host
      .querySelector("[data-crop=save]")
      .addEventListener("click", () => canvas.toBlob((blob) => finish(blob), "image/jpeg", 0.9));
  });
}
