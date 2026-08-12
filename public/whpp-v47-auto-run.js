(function installWhppV47Compatibility(global) {
  if (global.__CE_QC_V47_COMPAT__) return;

  const VERSION = '2026-08-12-v47-seven-business-compat-v4';

  function install() {
    // V67 is the single authoritative start/resume orchestrator. Keeping a
    // second wrapper here caused WHPP to run twice after a successful all-business
    // cycle and forced another heavy state check. V47 now remains only as a
    // compatibility marker for older injected layouts.
    global.__CE_QC_V47_COMPAT__ = {
      version: VERSION,
      authoritativeRunner: 'V67'
    };
    console.info('[CE-QC][V47_COMPAT]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})(window);
