import fs from 'node:fs';

function patchFile(file, replacements) {
  let source = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const { before, after, label } of replacements) {
    if (source.includes(after)) continue;
    const count = source.split(before).length - 1;
    if (count !== 1) throw new Error(`${file} ${label}: expected exactly one match, got ${count}`);
    source = source.replace(before, after);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, source, 'utf8');
}

patchFile('public/app.js', [
  {
    label: 'side navigation CEAF',
    before: "['home','首页总看板','home','/'], ['ce','CE看板','package','/ce'], ['tbkh','TBKH看板','package','/tbkh'], ['ali1688','ALI1688看板','package','/ali1688'],",
    after: "['home','首页总看板','home','/'], ['ce','CE看板','package','/ce'], ['ceaf','CEAF空运看板','package','/ceaf'], ['tbkh','TBKH看板','package','/tbkh'], ['ali1688','ALI1688看板','package','/ali1688'],"
  },
  {
    label: 'refresh current business pages',
    before: "const businessType = ['ce','tbkh','ali1688','shopeecn','shopeevn'].includes(currentPage) ? currentBusinessType() : '';",
    after: "const businessType = ['ce','ceaf','tbkh','ali1688','shopeecn','shopeevn'].includes(currentPage) ? currentBusinessType() : '';"
  },
  {
    label: 'render CCSL pages',
    before: "else if (['ce', 'tbkh', 'ali1688'].includes(currentPage)) renderCcslPage();",
    after: "else if (['ce', 'ceaf', 'tbkh', 'ali1688'].includes(currentPage)) renderCcslPage();"
  },
  {
    label: 'page route CEAF',
    before: "const routes = { '/ce':'ce', '/tbkh':'tbkh', '/ali1688':'ali1688', '/shopeecn':'shopeecn', '/shopeevn':'shopeevn',",
    after: "const routes = { '/ce':'ce', '/ceaf':'ceaf', '/tbkh':'tbkh', '/ali1688':'ali1688', '/shopeecn':'shopeecn', '/shopeevn':'shopeevn',"
  },
  {
    label: 'navigate CEAF',
    before: "currentPage = ['ce', 'tbkh', 'ali1688', 'shopeecn', 'shopeevn', 'tracking', 'exceptions', 'reports', 'import', 'settings', 'logs', 'data-management'].includes(page) ? page : 'home';",
    after: "currentPage = ['ce', 'ceaf', 'tbkh', 'ali1688', 'shopeecn', 'shopeevn', 'tracking', 'exceptions', 'reports', 'import', 'settings', 'logs', 'data-management'].includes(page) ? page : 'home';"
  },
  {
    label: 'hydrate CEAF page',
    before: "if (['ce', 'tbkh', 'ali1688', 'shopeecn', 'shopeevn'].includes(page)) {",
    after: "if (['ce', 'ceaf', 'tbkh', 'ali1688', 'shopeecn', 'shopeevn'].includes(page)) {"
  },
  {
    label: 'sync six business snapshots',
    before: "const types = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];",
    after: "const types = ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];"
  },
  {
    label: 'sync CCSL slice four',
    before: "const ccslTypes = types.slice(0, 3);\n  const shopeeTypes = types.slice(3);",
    after: "const ccslTypes = types.slice(0, 4);\n  const shopeeTypes = types.slice(4);"
  },
  {
    label: 'visible CCSL page list',
    before: "const ccslPages = ['ce', 'tbkh', 'ali1688'];",
    after: "const ccslPages = ['ce', 'ceaf', 'tbkh', 'ali1688'];"
  },
  {
    label: 'topbar CEAF title',
    before: "const titles = { home: '首页总看板', ce: 'CE看板', tbkh: 'TBKH看板', ali1688: 'ALI1688看板',",
    after: "const titles = { home: '首页总看板', ce: 'CE看板', ceaf: 'CEAF空运看板', tbkh: 'TBKH看板', ali1688: 'ALI1688看板',"
  },
  {
    label: 'CCSL heading CEAF',
    before: "if (ccslHeading && ['ce','tbkh','ali1688'].includes(currentPage)) ccslHeading.textContent = titles[currentPage];",
    after: "if (ccslHeading && ['ce','ceaf','tbkh','ali1688'].includes(currentPage)) ccslHeading.textContent = titles[currentPage];"
  },
  {
    label: 'period six types',
    before: "function applyPeriodDashboardResult(result, mode, anchor, shouldRender = true) {\n  const types = ['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];",
    after: "function applyPeriodDashboardResult(result, mode, anchor, shouldRender = true) {\n  const types = ['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'];"
  },
  {
    label: 'history hydrate CEAF',
    before: "if (['ce','tbkh','ali1688','shopeecn','shopeevn'].includes(currentPage)) await hydratePageData(currentPage);",
    after: "if (['ce','ceaf','tbkh','ali1688','shopeecn','shopeevn'].includes(currentPage)) await hydratePageData(currentPage);"
  },
  {
    label: 'current business CEAF map',
    before: "return ({ ce:'CE', tbkh:'TBKH', ali1688:'ALI1688', shopeecn:'SHOPEECN', shopeevn:'SHOPEEVN' })[currentPage] || 'CE';",
    after: "return ({ ce:'CE', ceaf:'CEAF', tbkh:'TBKH', ali1688:'ALI1688', shopeecn:'SHOPEECN', shopeevn:'SHOPEEVN' })[currentPage] || 'CE';"
  },
  {
    label: 'metric detail CEAF target',
    before: "(['ce', 'tbkh', 'ali1688'].includes(currentPage) ? currentPage : 'ce');",
    after: "(['ce', 'ceaf', 'tbkh', 'ali1688'].includes(currentPage) ? currentPage : 'ce');"
  },
  {
    label: 'purge six business states',
    before: "businessStates = Object.fromEntries(['CE','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].map(type => [type, {}]));",
    after: "businessStates = Object.fromEntries(['CE','CEAF','TBKH','ALI1688','SHOPEECN','SHOPEEVN'].map(type => [type, {}]));"
  },
  {
    label: 'export CEAF exact board',
    before: "if (['CE', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].includes(type)) {",
    after: "if (['CE', 'CEAF', 'TBKH', 'ALI1688', 'SHOPEECN', 'SHOPEEVN'].includes(type)) {"
  },
  {
    label: 'unified import alert CEAF',
    before: "alert(`综合日报导入成功：有效${result.summary.validUniqueWaybills}票，CE ${result.classificationCounts.CE}，TBKH ${result.classificationCounts.TBKH}，ALI1688 ${result.classificationCounts.ALI1688}，SHOPEE CN ${result.classificationCounts.SHOPEECN}，SHOPEE VN ${result.classificationCounts.SHOPEEVN}。`);",
    after: "alert(`综合日报导入成功：有效${result.summary.validUniqueWaybills}票，CE ${result.classificationCounts.CE}，CEAF空运 ${result.classificationCounts.CEAF || 0}，TBKH ${result.classificationCounts.TBKH}，ALI1688 ${result.classificationCounts.ALI1688}，SHOPEE CN ${result.classificationCounts.SHOPEECN}，SHOPEE VN ${result.classificationCounts.SHOPEEVN}。`);"
  },
  {
    label: 'empty six business text',
    before: "选择综合日报后，这里会显示五业务分类、PP/PV和数据质量统计。",
    after: "选择综合日报后，这里会显示六业务分类、PP/PV和数据质量统计。"
  },
  {
    label: 'classification grid CEAF',
    before: "[['CE','ce'],['TBKH','tbkh'],['ALI1688','ali1688'],['SHOPEECN','shopeecn'],['SHOPEEVN','shopeevn']]",
    after: "[['CE','ce'],['CEAF','ceaf'],['TBKH','tbkh'],['ALI1688','ali1688'],['SHOPEECN','shopeecn'],['SHOPEEVN','shopeevn']]"
  },
  {
    label: 'run six business text',
    before: "正在启动五业务处理，请勿重复点击",
    after: "正在启动六业务处理，请勿重复点击"
  },
  {
    label: 'home CEAF business card',
    before: "['ce', 'CE', useSingleDayImportCounts ? Number(importedCounts.CE || 0) : (dashboardPeriodMode ? rangeBusinessCount('CE') : cc.total), 'green'],\n    ['tbkh', 'TBKH',",
    after: "['ce', 'CE', useSingleDayImportCounts ? Number(importedCounts.CE || 0) : rangeBusinessCount('CE'), 'green'],\n    ['ceaf', 'CEAF空运', useSingleDayImportCounts ? Number(importedCounts.CEAF || 0) : rangeBusinessCount('CEAF'), 'blue'],\n    ['tbkh', 'TBKH',"
  }
]);

patchFile('public/dashboard-v18.js', [
  {
    label: 'home core scope includes CEAF',
    before: "<h2>核心指标总览 <small>仅 CE + TBKH + ALI1688，不含 SHOPEE CN/VN</small></h2>",
    after: "<h2>核心指标总览 <small>CE + CEAF空运 + TBKH + ALI1688，不含 SHOPEE CN/VN</small></h2>"
  }
]);
