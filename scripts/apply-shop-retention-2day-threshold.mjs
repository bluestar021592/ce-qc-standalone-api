import fs from 'node:fs';

const file = 'src/reporting.js';
let source = fs.readFileSync(file, 'utf8');
const before = `function isShopStuckRow(row = {}) {
  if (row?.shopState === 'SHOP_ARRIVED_CURRENT' && shopDays(row) >= 2) return true;
  return row?.门店状态 === '门店滞留'
    || row?.异常分类 === '门店滞留'
    || (isShopInboundRow(row) && shopDays(row) >= 2);
}`;
const after = `function isShopStuckRow(row = {}) {
  const state = String(row?.currentState || '').toUpperCase();
  const category = String(row?.primaryCategory || row?.主分类 || row?.异常分类 || '').trim();
  if (['SHOP_PENDING', 'SHOP_OC'].includes(state) || ['门店Pending', '门店OC'].includes(category)) return false;
  if (row?.shopState === 'SHOP_ARRIVED_CURRENT' && shopDays(row) >= 2) return true;
  return row?.门店状态 === '门店滞留'
    || row?.异常分类 === '门店滞留'
    || (isShopInboundRow(row) && shopDays(row) >= 2);
}`;
if (!source.includes(after)) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`shop retention Pending/OC exclusion expected one match, got ${count}`);
  source = source.replace(before, after);
  fs.writeFileSync(file, source, 'utf8');
}
