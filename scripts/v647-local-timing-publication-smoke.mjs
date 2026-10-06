import fs from 'node:fs';
import assert from 'node:assert/strict';

const summary=fs.readFileSync('src/homeQualitySummary.js','utf8');
const js=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(summary,/if\(job\.state!=='COMPLETED'\|\|!job\.result\)/);
assert.match(summary,/const localTiming=Object\.fromEntries/);
assert.match(summary,/blocking:false/);
assert.match(js,/showWhppScan=business==='WHPP'&&waiting>0/);
assert.match(js,/setProperty\('display',showWhppScan\?'inline-flex':'none','important'\)/);
assert.match(html,/v625-shell\.js\?v=\d{8}-v6(?:4[7-9]|[5-9]\d)-1/);
assert.match(html,/v625-shell\.css\?v=\d{8}-v6(?:4[7-9]|[5-9]\d)-1/);

console.log('[V647] local timing publication bypasses archive gate + zero-wait WHPP control hidden');
