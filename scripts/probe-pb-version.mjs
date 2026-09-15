const res = await fetch('https://db.keson.pro/api/health');
console.log('status', res.status);
console.log('headers', Object.fromEntries(res.headers.entries()));
console.log('body', await res.text());
const home = await fetch('https://db.keson.pro/');
const html = await home.text();
const matches = html.match(/PocketBase[^<"]{0,60}|v\d+\.\d+\.\d+/g);
console.log('home_status', home.status);
console.log('hints', matches);
const routes = [
  '/api/',
  '/_/',
  '/api/collections',
  '/api/realtime'
];
for (const path of routes) {
  const r = await fetch('https://db.keson.pro' + path);
  console.log(path, r.status, r.headers.get('x-pocketbase') || r.headers.get('server') || '');
}
