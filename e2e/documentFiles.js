import zlib from "node:zlib";
import { expect } from "@playwright/test";
import { API } from "./config.js";
import { certificatePdf } from "./pdf.js";
import { createAccountByInvitation } from "./helpers.js";

// Originales de prueba (B17-B18): se suben por la API real, como lo haría la app.

/** PNG RGB sin pérdida (franjas), para mostrar con <img>. DATOS SINTÉTICOS. */
export function stripesPng(width = 480, height = 300) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const shade = Math.floor(y / 30) % 2 ? 230 : 190;
    for (let x = 0; x < width; x++) rows.set([shade, shade, 245], y * (width * 3 + 1) + 1 + x * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Contador con un cliente y tres originales subidos por la API real: imagen, PDF y PDF dañado. */
export async function accountantWithFiles(request) {
  const account = await createAccountByInvitation({ name: "Visor E2E" });
  const headers = { Authorization: `Bearer ${account.accessToken}` };
  const stamp = Date.now();
  const client = await (
    await request.post(`${API}/api/clients`, {
      headers,
      data: { fullName: `Cliente Visor ${stamp}`, documentNumber: `E2E-${stamp}` },
    })
  ).json();
  const upload = async (name, mimeType, buffer) => {
    const res = await request.post(`${API}/api/documents/upload`, {
      headers,
      multipart: { clientId: client.id, docType: "income_certificate", file: { name, mimeType, buffer } },
    });
    expect(res.status(), `subir ${name}`).toBe(201);
    return (await res.json()).id;
  };
  const files = {
    image: await upload("extracto-escaneado.png", "image/png", stripesPng()),
    pdf: await upload("certificado-2025.pdf", "application/pdf", certificatePdf(`visor-${stamp}`)),
    damaged: await upload("danado.pdf", "application/pdf", Buffer.from(`%PDF-1.4\nesto no es un PDF ${stamp}\n`)),
  };
  return { account, client, files };
}
