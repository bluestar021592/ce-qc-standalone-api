import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const server=fs.readFileSync('server.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(server,/allRowCount: allRows\.length/,'tracking workspace must publish the full canonical row count');
assert.match(server,/rows: rows\.slice\(0, 5000\)/,'tracking workspace preview cap must remain for browser performance');
assert.match(shell,/const workspaceAllCount=Number\(wr\.allRowCount\|\|v628BusinessWorkspaceRows\.length\)/,'frontend must compare preview size with full workspace count');
assert.match(shell,/const workspaceTruncated=workspaceAllCount>v628BusinessWorkspaceRows\.length/,'frontend must detect a capped preview');
assert.match(shell,/setText\('v631AccountingMeta','已归类 '/,'status conservation must come from the full integrity ledger');
assert.match(shell,/if\(v628BusinessWorkspaceRows\.length&&!workspaceTruncated\)/,'frontend must never recompute conservation from a truncated preview');
assert.match(html,/ce-qc-build/,'current shell build marker missing');
assert.match(html,/v625-shell\.js\?v=/,'current shell cache bust missing');

console.log('[V733] capped 5000-row workspace previews cannot create false business conservation differences');
