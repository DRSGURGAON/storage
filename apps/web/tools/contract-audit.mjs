/**
 * Screen-vs-API contract audit.
 *
 * TypeScript checks that this app is consistent with *itself*. It cannot
 * check that an interface a screen declares matches what the server
 * actually sends: the API is JSON at runtime, so a field that was renamed,
 * or never existed, arrives as `undefined` and renders as a blank column.
 * The agreements screen read `effectiveFrom`, `effectiveTo` and
 * `clauses[].renderedClause` for three phases; the API has never returned
 * any of the three.
 *
 * So: for every `api<T>('/path')` call under `src/`, fetch that path from a
 * live server and compare the fields `T` declares against the keys that
 * actually come back.
 *
 *   cd apps/api && npm run start:dev     # a server, with data in it
 *   TOKEN=<a bearer token> node apps/web/tools/contract-audit.mjs
 *
 * It reports two kinds of line, and neither is automatically a bug: a
 * field the API does not return (usually is), and an endpoint it could not
 * reach to check (usually a path this script cannot construct, like
 * `/reports/run/:code`). Read them; do not just count them.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const API = process.env.API_URL ?? 'http://localhost:3000';

const files = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full);
    else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) files.push(full);
  }
};
walk(SRC);

// interface Name { a: T; b: T } -> field names
// Keyed by file, because several screens declare their own `Grn`/`Invoice`
// and comparing a screen against another screen's interface is noise.
// Keyed by file, because several screens declare their own `Grn`/`Invoice`
// and comparing a screen against another screen's interface is noise.
// Brace-balanced rather than regex-to-the-first-`}`: a field whose type is
// an inline object (`productSnapshot: { sku?: string } | null`) would
// otherwise truncate the interface and invent missing fields.
const interfaces = new Map();
const topLevelFields = (body) => {
  const fields = [];
  let depth = 0;
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (depth === 0) {
      const match = trimmed.match(/^(\w+)\??\s*:/);
      if (match) fields.push(match[1]);
    }
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
  }
  return fields;
};
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/interface\s+(\w+)\s*\{/g)) {
    const start = match.index + match[0].length;
    let depth = 1;
    let i = start;
    while (i < text.length && depth > 0) {
      if (text[i] === '{') depth += 1;
      else if (text[i] === '}') depth -= 1;
      i += 1;
    }
    interfaces.set(`${file}::${match[1]}`, { fields: topLevelFields(text.slice(start, i - 1)), file });
  }
}

// api<Name>('path') / api<Name>(`path`) — single-type calls only.
const calls = [];
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/api<(\w+)(\[\])?>\(\s*[`'"]([^`'"]+)[`'"]/g)) {
    calls.push({ type: match[1], isArray: Boolean(match[2]), path: match[3], file: file.replace(SRC + '/', '') });
  }
}

const token = process.env.TOKEN;
const seen = new Set();
/** A field the screen reads and the API does not send. */
const mismatches = [];
/** An endpoint this script could not construct or was not allowed to call. */
const unchecked = [];

for (const call of calls) {
  const iface =
    interfaces.get(`${SRC}/${call.file}::${call.type}`) ??
    [...interfaces.entries()].filter(([k]) => k.endsWith(`::${call.type}`)).map(([, v]) => v)[0];
  if (!iface) continue;
  // Only paths with no interpolation, or with a single ${id} we can fill.
  const key = `${call.type} ${call.path}`;
  if (seen.has(key)) continue;
  seen.add(key);
  let path = call.path;
  if (path.includes('${')) {
    // `/grns/${id}` and friends: resolve the id from the list endpoint.
    const base = path.slice(0, path.indexOf('/${'));
    const rest = path.slice(path.indexOf('/${')).replace(/\/\$\{[^}]+\}/, '');
    if (!base.startsWith('/') || base.includes('${')) continue;
    const listRes = await fetch(`${API}${base}?limit=1`, { headers: { authorization: `Bearer ${token}` } });
    if (!listRes.ok) { unchecked.push(`${call.file}: GET ${base} (to resolve an id) -> ${listRes.status}`); continue; }
    const listBody = await listRes.json();
    const first = Array.isArray(listBody) ? listBody[0] : listBody.items?.[0];
    if (!first?.id) { unchecked.push(`${call.file}: nothing in ${base} to open, so ${path} went unchecked`); continue; }
    path = `${base}/${first.id}${rest}`;
  }
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) {
    unchecked.push(`${call.file}: GET ${path} -> ${res.status}`);
    continue;
  }
  const body = await res.json();
  // A page has `items` *and* a total; a detail record can have `items`
  // of its own (a GRN's lines), and treating those as the page would
  // compare the record's interface against one of its line items.
  const isPage = body && typeof body === 'object' && Array.isArray(body.items) && typeof body.total === 'number';
  const sample = Array.isArray(body) ? body[0] : isPage ? body.items[0] : body;
  if (!sample || typeof sample !== 'object') continue;
  const actual = new Set(Object.keys(sample));
  const missing = iface.fields.filter((f) => !actual.has(f));
  if (missing.length) {
    mismatches.push(`${call.file}: ${call.type} <- ${path} declares fields the API does not return: ${missing.join(', ')}`);
  }
}

console.log(`Checked ${seen.size} endpoint/type pairs.\n`);
console.log(mismatches.length ? `Mismatches:\n${mismatches.join('\n')}` : 'No mismatches: every field a screen reads, the API sends.');
if (unchecked.length) console.log(`\nCould not check (not necessarily a problem):\n${unchecked.join('\n')}`);
process.exitCode = mismatches.length ? 1 : 0;
