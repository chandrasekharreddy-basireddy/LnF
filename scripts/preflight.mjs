/**
 * Refuses to build a deployment that cannot reach its database.
 *
 * NEXT_PUBLIC_* values are inlined at build time, so a Vercel project whose
 * variables were added after the last build ships a bundle with empty strings —
 * every query fails, every page renders its "could not load" state, and the
 * site looks like an empty board rather than a broken one. That is what
 * landf.vercel.app did on 28/11. A failed build is a better answer.
 */
import { existsSync, readFileSync } from 'node:fs';

// next build loads .env.local; a plain node script does not. Read the same file
// so a developer running `npm run build` sees the same verdict as Vercel does.
for (const file of ['.env.local', '.env']) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const [, name, raw] = match;
    if (process.env[name]) continue;
    process.env[name] = raw.replace(/^["']|["']$/g, '');
  }
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

// CI builds against a local mock, and that must keep working
const isLocalMock = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(url);

const problems = [];
if (!isLocalMock && (!url.startsWith('https://') || !url.includes('.supabase.'))) {
  problems.push(`NEXT_PUBLIC_SUPABASE_URL is ${url ? `"${url}"` : 'empty'} — expected https://<ref>.supabase.co`);
}
if (!isLocalMock && key.length < 40) {
  problems.push(`NEXT_PUBLIC_SUPABASE_ANON_KEY is ${key ? 'too short' : 'empty'}`);
}

// NEXT_PUBLIC_SITE_URL defaults to localhost, which would end up inside every
// email the app sends. Only a local build may leave it unset.
const site = process.env.NEXT_PUBLIC_SITE_URL ?? '';
const localBuild = process.env.VERCEL !== '1' && process.env.CI !== 'true';
if (!localBuild && !site.startsWith('https://')) {
  problems.push(`NEXT_PUBLIC_SITE_URL is ${site || 'empty'} — every email would link to ${site || 'localhost:3000'}`);
}

if (problems.length > 0) {
  console.error('\npreflight: this build cannot reach Supabase.');
  for (const p of problems) console.error('  - ' + p);
  console.error('\nSet them in Vercel → Settings → Environment Variables, then redeploy.');
  console.error('NEXT_PUBLIC_* values are baked in at build time: adding them is not enough.\n');
  process.exit(1);
}

console.log(`preflight: supabase configuration present${isLocalMock ? ' (local mock)' : ''}`);
