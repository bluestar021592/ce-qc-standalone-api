import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('V103 home WHPP guard is syntax-valid and derives missing WHPP from total conservation',()=>{
  const relative='public/v103-home-whpp-card-guard.js';
  const source=read(relative);
  const syntax=spawnSync(process.execPath,['--check',path.join(root,relative)],{encoding:'utf8'});
  assert.equal(syntax.status,0,syntax.stderr||syntax.stdout);
  assert.match(source,/const SIX=\['CE','CEAF空运','TBKH','SHOPEE CN','SHOPEE VN','ALI1688'\]/);
  assert.match(source,/const residual=Math\.max\(0,total-sixTotal\)/);
  assert.match(source,/ensureWhpp\(grid\)/);
  assert.match(source,/WHPP本土/);
  assert.match(source,/navigateWhppPage/);
});

test('V103 updates total and all business ratios after adding WHPP',()=>{
  const source=read('public/v103-home-whpp-card-guard.js');
  assert.match(source,/const finalTotal=sixTotal\+whppValue/);
  assert.match(source,/占总票数 100\.00%/);
  assert.match(source,/rate\(whppValue,finalTotal\)/);
});

test('normal HTML injection loads V103 after V64 WHPP integration',()=>{
  const source=read('src/v44WhppUiPatch.js');
  const v64=source.indexOf('v64-whpp-total-kpi-integration.js');
  const v103=source.indexOf('v103-home-whpp-card-guard.js');
  assert.ok(v64>=0 && v103>v64);
  assert.match(source,/v103-home-whpp-card-guard\.js\?v=20260814-1/);
});
