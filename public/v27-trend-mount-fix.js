(function retireLegacyV27TrendMount(global){
  // V139: this legacy browser trend runner is intentionally retired.
  // It previously wrapped DashboardV18 again, created duplicate trend sections
  // and displayed long-lived "正在读取派次趋势" placeholders. V138/V139 now
  // exclusively render all seven-business and SHOPEE attempt trends from the
  // cached truthful range-trend source. Keep only a marker for deployment diagnosis.
  global.__CE_QC_V27_TREND_MOUNT_RETIRED__={
    version:'2026-08-15-v139-retired-v27-trend-mount-v1',
    active:false,
    replacement:'V138_RANGE_TRENDS'
  };
  console.info('[CE-QC][V139] legacy V27 browser trend mount retired');
})(window);
