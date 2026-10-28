import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'v788-offline-cli-'));
try {
  const validFile=path.join(tmp,'2026-report.json');
  fs.writeFileSync(validFile,JSON.stringify({
    generatedAt:'2026-10-14T04:37:07Z',
    databaseCopyUnmodifiedDuringAudit:true,
    audit:{readOnly:true,active72:{count:72,uniqueCount:72},whpp:{
      byDate:[{date:'2026-07-01',sourceMembers:190,withCurrent:190},
        {date:'2026-07-02',sourceMembers:156,withCurrent:156}],
      totals:{sourceMembers:346,withCurrent:346,normalizedPOD:290,
        normalizedReturned:56,strictPOD:0,strictReturned:0,returning80:0,
        labelOnlyTerminal:346,otherUnverified:0,contradiction:0,
        savedTmsCurrentConflict:0,ledgerOpenWithNormalizedTerminal:346,
        ledgerTerminalWithNonterminal:0,ledgerTerminalContradictingTms:0,
        trustedPodLockOnPOD:0,trustedPodLockOnNonPOD:0}
    },sevenBusinessSource:{available:false,byDate:[]}},
    verdict:{readyToPublish:false,readyToClearAndReimport:false}
  }));
  const invoke=file=>spawnSync(process.execPath,['scripts/v788-offline-release-review.mjs',file],
    {encoding:'utf8',timeout:10000,cwd:process.cwd(),env:{...process.env,V788_READONLY_REPORT_FILE:''}});
  const blocked=invoke(validFile);
  assert.equal(blocked.status,10,'offline viewer cannot grant 0 exit status');
  assert.match(blocked.stdout,/WHPP 来源票数：346/);
  assert.match(blocked.stdout,/可信POD时间：0\/290/);
  assert.match(blocked.stdout,/发布决策：BLOCKED/);
  assert.match(blocked.stdout,/正式系统5177：不得据此发布、清空或重新导入/);
  assert.doesNotMatch(blocked.stdout,/CE010726\d{5}/,'no waybill leakage');
  assert.equal(invoke(path.join(tmp,'missing.json')).status,10,'missing report stays blocked');
  const cli=fs.readFileSync('scripts/v788-offline-release-review.mjs','utf8');
  assert.doesNotMatch(cli,/writeFile|unlink|rmSync|execFile|spawn|fetch\(/);
  const cmd=fs.readFileSync('V788_查看验收记录_只读.cmd','utf8');
  assert.match(cmd,/v788-offline-release-review\.mjs/);
  assert.doesNotMatch(cmd,/git\s+pull|npm\s+install|del\s|rmdir|robocopy|UPDATE |DELETE |data-purge/i);
  console.log('[V788 OFFLINE VIEW] historical source 346 / POD time 0 of 290 remains blocked; missing report blocked; Windows viewer read-only PASS');
}finally{
  fs.rmSync(tmp,{recursive:true,force:true}); // test fixture only
}
