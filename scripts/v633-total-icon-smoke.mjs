import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const html=fs.readFileSync(path.join(root,'public','v625-shell.html'),'utf8');
const css=fs.readFileSync(path.join(root,'public','v625-shell.css'),'utf8');
const icons=fs.readFileSync(path.join(root,'public','assets','ui-icons-v625.svg'),'utf8');

assert.match(icons,/id="icon-stack-total"/,'layered total-ticket icon symbol missing');
assert.match(icons,/12 3 3\.5 7\.5 12 12/,'top layer geometry missing');
assert.match(html,/ui-icons-v625\.svg#icon-stack-total/,'total card must render layered icon');
assert.doesNotMatch(html,/v632-total-icon">▰</,'legacy placeholder glyph must be removed');
assert.match(css,/\.v632-total-icon\{[^}]*color:#7a42ea[^}]*background:#efe6ff/,'approved purple icon treatment missing');
assert.match(html,/v625-shell\.js\?v=20261005-v63[356]-1/,'V633 JS cache bust missing');
assert.match(html,/v625-shell\.css\?v=20261005-v63[356]-1/,'V633 CSS cache bust missing');

console.log('[V633] approved layered total-ticket icon smoke passed');
