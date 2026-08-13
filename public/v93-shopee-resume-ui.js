(function installV93ShopeeResumeUi(global) {
  if (global.__CE_QC_V93_SHOPEE_RESUME_UI__) return;
  const VERSION = '2026-08-13-v93-shopee-resume-ui-v1';

  function install() {
    const original = global.runStatusMarkup;
    if (typeof original !== 'function') {
      setTimeout(install, 50);
      return;
    }
    if (original.__v93Wrapped) return;

    const wrapped = function v93RunStatusMarkup(state) {
      const html = original(state);
      if (String(state?.businessType || '').toUpperCase() !== 'SHOPEE') return html;
      const processing = state?.processing || {};
      if (/扫描/.test(String(processing.phase || ''))) return html;
      const batchIndex = Number(processing.batchIndex || 0);
      const totalBatches = Number(processing.totalBatches || 0);
      const eventRows = Number(state?.trackEvents || 0);
      const totalBills = Number(state?.total || 0);
      const status = batchIndex && totalBatches ? `当前批次 ${batchIndex}/${totalBatches}` : '轨迹批次准备中';
      const detail = `${status} · 已保存轨迹事件 ${eventRows.toLocaleString('zh-CN')} 条 · 日报运单 ${totalBills.toLocaleString('zh-CN')}票`;
      return String(html || '').replace(/<p>轨迹进度：[\s\S]*?<\/p>/, `<p>轨迹处理：${detail}</p>`);
    };
    wrapped.__v93Wrapped = true;
    global.runStatusMarkup = wrapped;
    global.__CE_QC_V93_SHOPEE_RESUME_UI__ = { version: VERSION };
    console.info('[CE-QC][V93_SHOPEE_RESUME_UI]', VERSION);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(install, 0), { once: true });
  else setTimeout(install, 0);
})(window);
