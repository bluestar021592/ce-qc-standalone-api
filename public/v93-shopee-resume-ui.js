(function installV93ShopeeResumeUi(global) {
  if (global.__CE_QC_V93_SHOPEE_RESUME_UI__) return;
  const VERSION = '2026-08-15-v136-shopee-manual-resume-only-v3';

  function install() {
    const original = global.runStatusMarkup;
    if (typeof original !== 'function') {
      setTimeout(install, 50);
      return;
    }
    if (original.__v136Wrapped) return;

    const wrapped = function v136RunStatusMarkup(state) {
      const html = original(state);
      if (String(state?.businessType || '').toUpperCase() !== 'SHOPEE') return html;
      const processing = state?.processing || {};
      const batchIndex = Number(processing.batchIndex || 0);
      const totalBatches = Number(processing.totalBatches || 0);
      const status = batchIndex && totalBatches ? `当前批次 ${batchIndex}/${totalBatches}` : '等待人工开始/继续处理';
      return String(html || '').replace(/SHOPEE/g, 'SHOPEE CN + SHOPEE VN').replace(/<p>轨迹进度：[\s\S]*?<\/p>/, `<p>处理进度：${status}</p>`);
    };
    wrapped.__v136Wrapped = true;
    global.runStatusMarkup = wrapped;
    global.__CE_QC_V93_SHOPEE_RESUME_UI__ = {
      version: VERSION,
      autoResumeDisabled: true,
      reason: 'Foreground processing starts only after explicit user action. Historical OPEN carry is refreshed by the backend scheduler.'
    };
    console.info('[CE-QC][V136_SHOPEE_MANUAL_RESUME_ONLY]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})(window);