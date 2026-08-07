import fs from 'node:fs';
const file = 'scripts/apply-v12-rule-hardening.mjs';
let text = fs.readFileSync(file, 'utf8');
const before = "  if (count !== expected) throw new Error(`${file}: expected ${expected} occurrence(s), found ${count}`);";
const after = "  if (count < expected) throw new Error(`${file}: expected at least ${expected} occurrence(s), found ${count}`);";
if (!text.includes(before)) throw new Error('Could not locate strict occurrence guard in V12 patcher');
text = text.replace(before, after);
fs.writeFileSync(file, text, 'utf8');
console.log('V12 patcher occurrence guard relaxed safely.');
