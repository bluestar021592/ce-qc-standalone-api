export const V290_INTERACTIVE_STARTUP_GRACE_ID='2026-08-24-v290-five-minute-first-paint-grace-v1';

const MIN_GRACE_MS=5*60_000;
const MAX_GRACE_MS=30*60_000;
const requested=Number(process.env.CE_QC_INTERACTIVE_STARTUP_GRACE_MS||MIN_GRACE_MS);
export const V290_INTERACTIVE_STARTUP_GRACE_MS=Math.max(MIN_GRACE_MS,Math.min(MAX_GRACE_MS,Number.isFinite(requested)?requested:MIN_GRACE_MS));

const BOOT_AT_KEY=Symbol.for('ce-qc.v290.interactive-boot-at');
if(!globalThis[BOOT_AT_KEY])globalThis[BOOT_AT_KEY]=Date.now();
export const V290_INTERACTIVE_BOOT_AT=Number(globalThis[BOOT_AT_KEY]);

export function v290DelayFromBoot(targetAfterBootMs=V290_INTERACTIVE_STARTUP_GRACE_MS){
  const target=V290_INTERACTIVE_BOOT_AT+Math.max(V290_INTERACTIVE_STARTUP_GRACE_MS,Number(targetAfterBootMs)||0);
  return Math.max(0,target-Date.now());
}

export function v290StartupGraceRemainingMs(){
  return v290DelayFromBoot(V290_INTERACTIVE_STARTUP_GRACE_MS);
}

export function v290StartupGraceActive(){
  return v290StartupGraceRemainingMs()>0;
}

export function v290AutoTaskDelay(targetAfterBootMs){
  return v290DelayFromBoot(Math.max(V290_INTERACTIVE_STARTUP_GRACE_MS,Number(targetAfterBootMs)||0));
}

console.info('[CE-QC][V290_FIRST_PAINT_GRACE]',V290_INTERACTIVE_STARTUP_GRACE_ID,`automatic heavy DB maintenance is held for at least ${Math.round(V290_INTERACTIVE_STARTUP_GRACE_MS/1000)}s after runtime activation; manual/import paths remain available.`);
