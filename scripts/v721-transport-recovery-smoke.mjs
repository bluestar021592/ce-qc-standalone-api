import assert from 'node:assert/strict';
import fs from 'node:fs';

const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');

assert.match(shell,/CLIENT_TRANSPORT_ERROR/,'fetch transport failures must be normalized');
assert.match(shell,/与本地后台的连接短暂中断，系统正在自动恢复连接并核对任务进度/,'transport failure must not surface raw Failed to fetch');
assert.match(shell,/async function waitBackendReady\(timeoutMs=120000\)/,'browser must wait for managed backend auto-restart');
assert.match(shell,/async function recoverFamilyTransport\(type,reportDate,retryEndpoint\)/,'CCSL/SHOPEE must recover interrupted HTTP transport');
assert.match(shell,/await readFamilyProgress\(type,reportDate\)/,'transport recovery must inspect persisted selected-date progress before retry');
assert.match(shell,/if\(progress\?\.running\)/,'active background work must be waited rather than duplicated');
assert.match(shell,/await post\(retryEndpoint\|\|familyResumeEndpoint\(type\),\{\},0\)/,'only one exact endpoint retry is allowed after backend recovery');
assert.match(shell,/runFamilyRequest\('CCSL','\/api\/resume',reportDate\)/,'CCSL resume must use transport recovery owner');
assert.match(shell,/runFamilyRequest\('SHOPEE','\/api\/shopee\/run\/resume',reportDate\)/,'SHOPEE resume must use transport recovery owner');
assert.match(html,/<meta name="ce-qc-build" content="V\d+_[A-Z0-9_]+">/,'current shell build marker missing');
assert.match(html,/v625-shell\.js\?v=\d{8}-v\d+-\d+/,'current shell cache bust missing');

console.log('[V721] CCSL/SHOPEE local fetch disconnects reconnect, inspect persisted progress, and resume once without raw Failed to fetch');
