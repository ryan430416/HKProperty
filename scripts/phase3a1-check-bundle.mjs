import fs from 'node:fs';
const html = fs.readFileSync('dist/index.html', 'utf8');
const m = html.match(/assets\/[^"]+\.js/);
if (!m) {
  console.error('no bundle');
  process.exit(1);
}
const t = fs.readFileSync(`dist/${m[0]}`, 'utf8');
const bare = /(?<![.\w])RESERVATION_STATUSES(?!\s*[:=])/.test(t);
console.log(JSON.stringify({ bundle: m[0], bareRESERVATION_STATUSES: bare, size: t.length }, null, 2));
if (bare) process.exit(2);
