/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Applies every .sql file in supabase/migrations/ (sorted by filename)
 * against the Postgres database pointed to by DATABASE_URL.
 *
 * Usage:  pnpm db:migrate
 */
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

function loadEnv() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function main() {
  loadEnv();

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env (Supabase → Project Settings → Database → Connection string → URI).");
    process.exit(1);
  }

  const migrationsDir = path.join(__dirname, "..", "supabase", "migrations");
  if (!fs.existsSync(migrationsDir)) {
    console.error(`No migrations directory at ${migrationsDir}`);
    process.exit(1);
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No .sql files to apply.");
    return;
  }

  const client = new Client({
    connectionString: url,
    ssl: url.includes("supabase.com") || url.includes("supabase.co") ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();
  try {
    for (const file of files) {
      const full = path.join(migrationsDir, file);
      const sql = fs.readFileSync(full, "utf8");
      console.log(`→ applying ${file}`);
      await client.query(sql);
      console.log(`  ✓ ${file}`);
    }
    console.log(`Applied ${files.length} migration(s).`);
  } catch (err) {
    console.error("Migration failed:", err.message || err);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
