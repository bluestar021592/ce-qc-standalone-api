import fs from 'node:fs';
const file = 'scripts/apply-final-system-foundation.mjs';
let source = fs.readFileSync(file, 'utf8');
const marker = "\npatchFile('src/rangeDashboardStoreV31.js', [";
const index = source.indexOf(marker);
if (index < 0) throw new Error('final range patch marker not found');
source = source.slice(0, index).trimEnd() + '\n';
fs.writeFileSync(file, source, 'utf8');
