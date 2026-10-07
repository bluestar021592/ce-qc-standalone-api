import assert from 'node:assert/strict';
import fs from 'node:fs';

const html=fs.readFileSync('public/v625-shell.html','utf8');
const server=fs.readFileSync('server.js','utf8');

assert.ok(html.startsWith('<!doctype html>'),'V625 shell must begin with HTML doctype');
assert.doesNotMatch(html,/<meta name="ce-qc-shell"[^>]*>\\n\s*<meta name="ce-qc-build"/,
  'document head must not contain a literal backslash-n text node between meta tags');
assert.match(html,/<meta name="ce-qc-shell" content="V625_FULL_SYSTEM_UI">\r?\n\s*<meta name="ce-qc-build" content="V719_VALID_HTML_SHELL">/,
  'V625 shell head must contain a real newline and V719 build marker');
assert.match(html,/<body data-page="__V625_PAGE_KEY__" data-business="__V625_BUSINESS_TYPE__">/);
assert.match(html,/<div class="v625-app">/);
assert.match(html,/<aside class="v625-sidebar">/);
assert.match(html,/v625-shell\.js\?v=20261007-v719-1/);
assert.match(server,/res\.type\('html'\)\.send\(html\)/,'V625 route must still return HTML');

console.log('[V719] V625 shell is structurally valid HTML: no literal \\n head text, full app/sidebar/body markers retained');
