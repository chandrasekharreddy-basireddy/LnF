/**
 * Fails when a migration defines a SECURITY DEFINER function that calls digest()
 * without `extensions` on its search_path.
 *
 * This bug has been introduced three times (0017 fixed it, 0022 and 0038 undid
 * it), each time by re-creating a function from an older file. The database
 * cannot catch it — event triggers need superuser — so the check lives here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.cwd(), 'supabase/migrations');
const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();

// the last definition of each function wins, so track them in order
const latest = new Map();
const problems = [];

for (const file of files) {
  const sql = readFileSync(path.join(DIR, file), 'utf8');
  const re = /create or replace function\s+public\.(\w+)\s*\(([\s\S]*?)\$\$;/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1];
    const body = m[0];
    if (!/security definer/i.test(body)) continue;
    if (!/digest\s*\(/i.test(body)) continue;
    const hasExtensions = /set\s+search_path\s*=\s*[^$\n]*extensions/i.test(body);
    latest.set(name, { file, hasExtensions });
  }
}

// a later `alter function ... set search_path = public, extensions` also fixes it
for (const file of files) {
  const sql = readFileSync(path.join(DIR, file), 'utf8');
  const re = /alter function\s+public\.(\w+)[^;]*set\s+search_path\s*=\s*[^;]*extensions/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    if (latest.has(m[1])) latest.get(m[1]).hasExtensions = true;
  }
  // the sweep in 0025/0039 applies the same fix by pattern
  if (/prosrc like '%digest\(%'/i.test(sql)) {
    for (const info of latest.values()) info.hasExtensions = true;
  }
}

for (const [name, info] of latest) {
  if (!info.hasExtensions) problems.push(`${name}  (last defined in ${info.file})`);
}

if (problems.length > 0) {
  console.error('search_path guard: these SECURITY DEFINER functions call digest() without extensions:');
  for (const p of problems) console.error('  - ' + p);
  console.error('\npgcrypto lives in `extensions`; without it every write fails with 42883.');
  process.exit(1);
}

console.log(`search_path guard: clean (${latest.size} hashing definer functions)`);
