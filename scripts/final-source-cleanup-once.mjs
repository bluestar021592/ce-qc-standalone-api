import fs from 'node:fs';

function dedupeUnknownShop(file) {
  let source = fs.readFileSync(file, 'utf8');
  const marker = `  } else if (unknownShopCode) {`;
  const first = source.indexOf(marker);
  const second = first >= 0 ? source.indexOf(marker, first + marker.length) : -1;
  if (first >= 0 && second >= 0) source = source.slice(0, first) + source.slice(second);
  if ((source.split(marker).length - 1) !== 1) throw new Error(`${file}: expected one unknown-shop branch after cleanup`);
  fs.writeFileSync(file, source, 'utf8');
}

dedupeUnknownShop('src/analyzerV30.js');
dedupeUnknownShop('src/shopeeAnalyzerV30.js');

let shopee = fs.readFileSync('src/shopeeAnalyzerV30.js', 'utf8');
shopee = shopee.replace(`  TRACK.INBOUND_NO_SCAN,`, `  TRACK.PICKUP_SUCCESS,`);
if (shopee.includes('TRACK.INBOUND_NO_SCAN')) throw new Error('legacy code26 inbound-no-scan reference remains in Shopee analyzer');
fs.writeFileSync('src/shopeeAnalyzerV30.js', shopee, 'utf8');
