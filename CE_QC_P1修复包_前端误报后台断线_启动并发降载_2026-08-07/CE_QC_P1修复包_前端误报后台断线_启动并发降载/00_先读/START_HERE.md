# CE QC P1 前端误报“后台断线”修复

## 已验证事实
九接口逐项诊断结果：
- /api/health：HTTP 200，正常
- /api/session：HTTP 200，正常
- /api/ce-auth-status：HTTP 200，正常
- /api/state?compact=1：HTTP 200，正常
- /api/shopee/state?compact=1：HTTP 200，正常
- /api/history?businessType=CCSL：HTTP 200，正常
- /api/history?businessType=SHOPEE：HTTP 200，正常
- /api/unified-history：HTTP 200，正常
- /api/import/unified-latest?compact=1：HTTP 200，正常
- 每个接口请求完成后 /api/health 仍然正常

因此：
后台Node、5177、SQLite均在线。
当前弹窗属于前端启动并发/错误分类逻辑问题。

## 本补丁只修改
`public/app.js`

原始SHA-256：
`295dd1c1ebb69ac0910d9756024456aa65ce42c55277edd10843bf58cfa014cd`

修复SHA-256：
`b0ee8eddad73d9d9403a194c53fb8d6ea28e7ad59a165a56324fcb34bc34f57e`

## 修复内容
1. 页面启动的9个请求不再使用一次性 Promise.all 并发突发。
2. 改为受控顺序读取，避免多个大型Snapshot/History接口同时挤压Node。
3. settings、logs、data-management、import 等页面不再启动后立刻额外加载五业务统一快照。
4. 五业务统一快照从5路并发改为顺序读取。
5. 某一个接口连接失败时，自动再次探测 `/api/health`：
   - health正常 → 判定“单接口/启动瞬时异常”，不再误报整个后台断线。
   - health失败 → 才判定真实后台服务离线。
6. 非关键接口失败时保留已经成功读取的数据，不让整个页面一起失败。
7. 原来的全局阻塞弹窗改为：
   - 后台真离线：才提示用户。
   - 后台正常但部分接口失败：只记录Console，页面继续工作。
8. 不改数据库、不改业务口径、不改UI布局、不改扫描/轨迹/Pending逻辑。

## 安装
解压到任意位置，双击：
`02_安装\Apply_P1_Frontend_Fix.bat`

安装器会自动定位正式项目：
`C:\Users\CELNT-EE-097\Documents\CE CCSL 质控研发APP\ce-qc-standalone-api`

并执行：
- SHA校验
- 原文件自动备份
- 替换 public/app.js
- `node --check`
- 失败自动恢复原文件

安装后：
1. 保持Start_CE_QC运行。
2. 浏览器按 Ctrl+F5 强制刷新。
3. 打开 /settings 和 /logs。
4. 验证不再出现错误的“与后台的连接已中断”弹窗。
