import fs from 'node:fs';

function replaceExact(file, before, after, expected = 1) {
  let text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const count = text.split(before).length - 1;
  if (count !== expected) throw new Error(`${file}: expected ${expected}, found ${count}`);
  text = text.replace(before, after);
  fs.writeFileSync(file, text, 'utf8');
}

replaceExact(
  'src/shopeeAnalyzer.js',
  "  if (/\\bPNH\\b|phnom\\s*penh|金边/i.test(province)) return { regionType: 'PHNOM_PENH', regionCode: 'PP', regionSource: 'destProvince' };\n  return { regionType: 'UNKNOWN', regionCode: 'UNKNOWN', regionSource: 'unresolved' };",
  "  if (/\\bPNH\\b|phnom\\s*penh|金边/i.test(province)) return { regionType: 'PHNOM_PENH', regionCode: 'PP', regionSource: 'destProvince' };\n  if (String(province || '').trim()) return { regionType: 'PROVINCE', regionCode: 'PV', regionSource: 'destProvince' };\n  return { regionType: 'UNKNOWN', regionCode: 'UNKNOWN', regionSource: 'unresolved' };"
);

replaceExact(
  'src/shopeeTemplateExporter.js',
  "    for (const row of rows) sheet.getRow(rowNumber++).values = detailValues(row);",
  "    for (const row of rows) {\n      const dataRow = sheet.getRow(rowNumber++);\n      dataRow.values = detailValues(row);\n      const shipmentCode = bill(row);\n      if (shipmentCode) {\n        const billCell = dataRow.getCell(2);\n        billCell.value = { text: shipmentCode, hyperlink: detailUrl(row) };\n        billCell.font = { ...billCell.font, color: { argb: 'FF0563C1' }, underline: true };\n        billCell.numFmt = '@';\n      }\n    }"
);

replaceExact(
  'src/shopeeTemplateExporter.js',
  "  return [row.reportDate || '', bill(row), row.orderTime || row.下单时间 || '', row.deliveryTime || row.派件时间 || '', row.statusCode || row.状态标识 || '', row.statusDesc || row.状态说明 || row.currentState || '', row.recipientProvince || row.收件省份 || '', region(row) === 'PP' ? '金边' : '外省', row.currentStore || row.当前门店 || '', row.currentProvince || row.当前省份 || '', row.recipient || row.收件人 || '', row.recipientPhone || row.收件人手机 || '', row.recipientAddress || row.收件地址 || '', row.courier || row.派件快递员 || '', row.exceptionDescription || row.异常描述 || row.外省未闭环分流 || row.primaryCategory || ''];",
  "  return [row.reportDate || '', bill(row), row.orderTime || row.下单时间 || '', row.deliveryTime || row.派件时间 || '', row.statusCode || row.状态标识 || '', row.statusDesc || row.状态说明 || row.currentState || '', row.recipientProvince || row.收件省份 || '', regionLabel(row), row.currentStore || row.当前门店 || '', row.currentProvince || row.当前省份 || '', row.recipient || row.收件人 || '', row.recipientPhone || row.收件人手机 || '', row.recipientAddress || row.收件地址 || '', row.courier || row.派件快递员 || '', row.exceptionDescription || row.异常描述 || row.外省未闭环分流 || row.primaryCategory || ''];"
);

replaceExact(
  'src/shopeeTemplateExporter.js',
  "function region(row = {}) { const value = String(row.regionCode || row.regionType || row.区域分类 || '').toUpperCase(); return value.includes('PP') || value.includes('金边') ? 'PP' : 'PV'; }",
  "function region(row = {}) {\n  const value = String(row.regionCode || row.regionType || row.区域分类 || '').trim().toUpperCase();\n  if (!value || value === 'UNKNOWN' || value === 'UNRESOLVED') return '';\n  if (value.includes('PP') || value.includes('PNH') || value.includes('PHNOM_PENH') || value.includes('金边')) return 'PP';\n  if (value.includes('PV') || value.includes('PROVINCE') || value.includes('外省')) return 'PV';\n  return '';\n}\nfunction regionLabel(row = {}) {\n  const value = region(row);\n  return value === 'PP' ? '金边' : value === 'PV' ? '外省' : '未识别';\n}\nfunction detailUrl(row = {}) {\n  const base = String(process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || 'http://127.0.0.1:5177').replace(/\\/$/, '');\n  const query = new URLSearchParams();\n  if (row.reportDate) query.set('reportDate', row.reportDate);\n  const shipmentCode = bill(row);\n  if (shipmentCode) query.set('shipmentCode', shipmentCode);\n  const businessType = String(row.businessType || '').trim().toUpperCase();\n  if (businessType) query.set('businessType', businessType);\n  return `${base}/detail?${query.toString()}`;\n}"
);

console.log('V13 export hardening applied.');
