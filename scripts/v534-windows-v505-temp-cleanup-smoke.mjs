import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const shimPath = 'test/v534-windows-v505-temp-cleanup-shim.mjs';
const checked = spawnSync(process.execPath, ['--check', shimPath], { encoding: 'utf8' });
assert.equal(checked.status, 0, `${shimPath} syntax failed: ${checked.stderr || checked.stdout}`);

const source = fs.readFileSync(shimPath, 'utf8');
assert.match(source, /process\.platform === 'win32'/, 'V534 must be Windows-only');
assert.match(source, /basename\.startsWith\('ce-qc-v505-'\)/, 'V534 must be scoped to V505 test temp dirs');
assert.match(source, /options\?\.recursive && options\?\.force/, 'V534 must only tolerate final recursive+force cleanup');
assert.match(source, /EPERM.*EBUSY.*ENOTEMPTY.*EACCES/s, 'V534 must whitelist only transient filesystem lock codes');
assert.match(source, /throw error;/, 'V534 must rethrow all non-matching cleanup failures');
assert.doesNotMatch(source, /DATA_DIR|DB_FILE|backupsDir|databasePath|sealedDatabasePath/, 'V534 must not touch production database routing');
console.log('[V534] Windows V505 temp-cleanup guard smoke passed · test-temp only · production paths untouched');
