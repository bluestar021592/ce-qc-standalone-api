# CE QC P0后台内存崩溃修复

## 已确认故障
- `RangeError: Invalid string length`
- `at JSON.stringify`
- `at createDashboardSnapshot (.../src/snapshots.js:82:12)`
- Node Heap约4096MB
- `FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory`
- Node退出后5177消失，前端显示“与后台的连接已中断”。

## 本补丁只修改
`src/snapshots.js`

原SHA-256：
`9f45fce81e87ceb8906db873baff00f27bdba2e1578d88a95b1cda38e861e7f1`

修复SHA-256：
`8e55ddeb61b0ee04d9c6ab6e72b55e1d0f4861f10a26ad581d3ddd50d98a7f15`

## 修复内容
1. Snapshot不再深拷贝/持久化完整运行state。
2. 只保存看板与导出需要的轻量字段。
3. 原始轨迹、扫描响应、图片、raw/json/payload等重数据不再重复写入Snapshot。
4. `detailTabs`与`xlsxRows`不再重复塞入payloadJson；现有服务需要时从state重新生成。
5. 数据Hash改为流式更新，避免先构造巨型JSON字符串。
6. Snapshot增加默认256MB安全上限，超限返回可控错误，不再把Node撑死。
7. Snapshot重算需要原始scan/track时，从SQLite规范表按日期按需读取。
8. 不修改数据库结构和正式业务数据。

## 使用
把整个修复包文件夹放到正式项目根目录：
`C:\Users\CELNT-EE-097\Documents\CE CCSL 质控研发APP\ce-qc-standalone-api`

然后双击：
`02_一键安装\Apply_P0_Memory_Fix.bat`

成功后再双击你原来的 `Start_CE_QC`。

之后打开：
- `http://127.0.0.1:5177`
- `/settings`
- `/logs`

最后执行一次真实日报处理，验证生成Snapshot时Node不再崩溃。

## 安全边界
- 不删除数据库
- 不改SQLite schema
- 不改.env
- 不改CE Token/Cookie
- 不改UI
- 不改Pending/扫描/轨迹业务规则
- 安装前校验当前`snapshots.js` SHA；如果Codex后来又改过它，会自动停止，不覆盖
