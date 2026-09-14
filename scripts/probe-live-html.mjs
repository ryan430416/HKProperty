const html = await (await fetch('https://hk-property.vercel.app/')).text();
const start = html.indexOf('id="publicPortal"');
const end = html.indexOf('id="staffLoginDialog"');
const portal = html.slice(start, end);
const forbidden = ['保管人', '單價', '保管單位', '測試模式', '以借用人', '學號', 'password', 'admin@'];
for (const word of forbidden) console.log(`portal ${portal.includes(word) ? 'YES' : 'NO'} ${word}`);
console.log('app_hidden_attr', html.includes('class="app" hidden'));
console.log('portal_unit', portal.includes('單位'));
console.log('portal_name', portal.includes('姓名'));
console.log('portal_phone', portal.includes('電話'));
console.log('return_fields_have_unit', portal.includes('id="portalUnitWrap"'));
const js = [...html.matchAll(/src="([^"]+\.js)"/g)].map((match) => match[1]);
console.log('scripts', js.join(','));
for (const src of js) {
  const text = await (await fetch(new URL(src, 'https://hk-property.vercel.app/'))).text();
  const hits = ['以借用人進入測試', '以經辦人員進入', '測試帳號', '預設密碼', 'hkp-admin@', 'localStorage', 'console.log'];
  const found = hits.filter((item) => text.includes(item));
  console.log('bundle', src, found.join('|') || 'clean');
}
