import { createHmac } from "node:crypto";

/**
 * Código TOTP (RFC 6238: HMAC-SHA1, 6 dígitos, 30 s) a partir del secreto en
 * base32, como lo calcula una app de autenticación. Implementación propia de
 * las pruebas, independiente de la del backend (verificación cruzada).
 * offset: pasos de 30 s hacia adelante (la API acepta ±1 y nunca repite uno).
 */
export function totpCode(secret, offset = 0) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret.replace(/\s/g, "").toUpperCase()]
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offset));
  const mac = createHmac("sha1", key).update(counter).digest();
  const at = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(at) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
