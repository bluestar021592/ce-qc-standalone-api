import fs from 'node:fs';
import assert from 'node:assert/strict';

const server=fs.readFileSync('server.js','utf8');
const shell=fs.readFileSync('public/v625-shell.js','utf8');
const html=fs.readFileSync('public/v625-shell.html','utf8');
const period=fs.readFileSync('src/periodExporter.js','utf8');

assert.match(shell,/familyLabels=\{/,'family labels must be computed once');
assert.match(shell,/Object\.values\(familyLabels\)\.filter\(label=>label==='完成'\)\.length/,'total completion must derive from rendered family labels');
assert.match(server,/app\.post\('\/api\/export-period\/job'/,'async export job endpoint missing');
assert.match(server,/app\.get\('\/api\/export-period\/job\/:jobId'/,'export job polling endpoint missing');
assert.match(server,/v652ExportJobs=new Map\(\)/,'export job state owner missing');
assert.match(period,/onProgress = null/,'period exporter progress callback missing');
assert.match(period,/reportProgress\(100,'COMPLETED'/,'period exporter must publish completion');
assert.match(shell,/async function pollExportJob/,'browser export polling missing');
assert.match(shell,/btn\.textContent='生成中…'/,'generate button must show busy state');
assert.match(shell,/生成失败：/,'export failure must be visible');
assert.match(html,/id="v652ExportBar"/,'visible export progress bar missing');
assert.match(html,/id="v652ExportMessage"/,'visible export status message missing');
assert.match(html,/v625-shell\.js\?v=20261005-v652-1/,'V652 JS asset revision missing');
console.log('[V652] consistent 3-family progress + async export task progress UI smoke passed');
