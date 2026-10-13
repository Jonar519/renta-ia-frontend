import path from "node:path";
import { fileURLToPath } from "node:url";

// API y base del stack E2E (en CI: E2E_API_URL y DATABASE_URL del job).
export const API = process.env.E2E_API_URL || "http://localhost:4100";
export const DATABASE_URL =
  process.env.E2E_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5433/renta_ia_e2e";
// Admin del seed (renta-ia-database/seed; el job de CI lo carga).
export const SEED_ADMIN = { email: "admin@example.com", password: "Password123!" };
// Sesión y secreto TOTP del admin del seed, escritos por globalSetup.js (no se versiona).
export const SEED_ADMIN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".auth", "seed-admin.json");
