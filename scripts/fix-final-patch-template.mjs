import fs from 'node:fs';
const file = 'scripts/apply-final-system-foundation.mjs';
let source = fs.readFileSync(file, 'utf8');
const needle = '${unknownShopCode}';
const replacement = '\\${unknownShopCode}';
const count = source.split(needle).length - 1;
if (count !== 2) throw new Error(`expected 2 unknownShopCode template sites, got ${count}`);
source = source.split(needle).join(replacement);
fs.writeFileSync(file, source, 'utf8');
