const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

(async () => {
  const exporterPath = path.resolve('src/v191ShopeeTruthExporter.js');
  const source = fs.readFileSync(exporterPath, 'utf8');
  if (source.includes("sheet.views=[{state:'frozen',ySplit:10}]")) {
    throw new Error('V196 regression: WorksheetWriter.views must not be assigned after creation');
  }
  if (!source.includes("addWorksheet('每日看板',{views:[{state:'frozen',ySplit:10}]})")) {
    throw new Error('V196 regression: dashboard frozen view must be supplied in addWorksheet options');
  }

  const file = path.join(os.tmpdir(), `ce-qc-v196-stream-view-${process.pid}-${Date.now()}.xlsx`);
  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: file, useStyles: true, useSharedStrings: false });
    const dashboard = workbook.addWorksheet('每日看板', { views: [{ state: 'frozen', ySplit: 10 }] });
    dashboard.addRow(['streaming-view-smoke']).commit();
    dashboard.commit();
    await workbook.commit();
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size <= 0) throw new Error('V196 regression: streaming workbook was not written');
    console.log('[V196] ExcelJS streaming WorksheetWriter frozen-view smoke passed');
  } finally {
    try { fs.unlinkSync(file); } catch {}
  }
})().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
