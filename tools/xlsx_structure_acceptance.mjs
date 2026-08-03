import ExcelJS from 'exceljs';

const file = process.argv[2];
if (!file) throw new Error('请提供XLSX路径');

const workbook = new ExcelJS.Workbook();
await workbook.xlsx.readFile(file);
const dashboardName = workbook.getWorksheet('01_总看板')
  ? '01_总看板'
  : workbook.getWorksheet('01_SHOPEE总看板')
    ? '01_SHOPEE总看板'
    : '';
const returnLinkFailures = [];
const imagesMissing = [];
const dashboardLinks = [];

for (const sheet of workbook.worksheets) {
  if (!sheet.getImages().length) imagesMissing.push(sheet.name);
  const formulas = [];
  sheet.eachRow({ includeEmpty: false }, row => row.eachCell(cell => {
    if (cell.value?.formula?.includes('HYPERLINK')) formulas.push(cell.value.formula);
  }));
  if (sheet.name === dashboardName) dashboardLinks.push(...formulas);
  else if (!formulas.some(formula => formula.includes(`#'${dashboardName}'!A1`))) returnLinkFailures.push(sheet.name);
}

const externalDashboardLinks = dashboardLinks.filter(formula => /[A-Z]:\\|file:|https?:/i.test(formula));
const result = {
  ok: Boolean(dashboardName) && !imagesMissing.length && !returnLinkFailures.length && !externalDashboardLinks.length && dashboardLinks.length > 0,
  file,
  dashboardName,
  sheetCount: workbook.worksheets.length,
  imagesMissing,
  returnLinkFailures,
  dashboardLinkCount: dashboardLinks.length,
  externalDashboardLinks,
  sampleDashboardLinks: dashboardLinks.slice(0, 4)
};
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;
