# CE 金边仓质控独立 API 版

这个版本不是浏览器页面脚本，不读取 OTWMS 页面 DOM，不依赖订单扫描页面渲染。

它是本地独立服务：

```text
日报Excel / 长期JSON
→ 本地解析
→ CE订单扫描API confirm-query
→ CE轨迹API shipment-event/query
→ POD / Pending / OC / 盘点 / 派件分配 / 派送停留 判断
→ 本地保存JSON
→ 导出XLSX
```

## 1. 安装

电脑需要安装 Node.js 18+。

```bash
cd ce-qc-standalone-api
npm install
cp .env.example .env
npm start
```

打开：

```text
http://127.0.0.1:5177
```

启动日志还会显示局域网访问地址，例如：

```text
本机访问: http://127.0.0.1:5177
局域网访问: http://192.168.x.x:5177
SQLite DB: D:\CE CCSL金边数据库\ce_qc_monitor.db
```

同一局域网电脑访问时，请使用“局域网访问”地址，不要使用 `127.0.0.1`。如果打不开，优先检查 Windows 防火墙是否允许 Node.js 5177 端口。

如需手动放行，请用管理员 PowerShell 执行（仅专用网络）：

```powershell
New-NetFirewallRule -DisplayName "CE CCSL QC 5177" -Direction Inbound -Protocol TCP -LocalPort 5177 -Action Allow -Profile Private
```

本轮仅支持同一 Wi-Fi / 局域网访问，不要把 5177 端口开放到公网。

## 2. 配置 CE 登录信息

`.env` 里保留 `CE_AUTHORIZATION` 作为 CE 登录接口需要的 Basic 基础认证。日常使用时在页面“CE系统登录”区域输入 CE 账号密码，系统会自动保存 `access_token` / `refresh_token` 到本地 token 文件。

默认本地数据保存到：

```text
D:\CE CCSL金边数据库
```

如果没有 D 盘，系统会自动回退到项目 `data` 目录，并在页面提示。

### 升级安全

代码升级不会删除或覆盖 `D:\CE CCSL金边数据库`。数据库结构需要升级时，系统会先在 `backups` 目录生成 `backup_before_migration_YYYYMMDD_HHmmss.db`，再在事务中执行幂等 migration。升级完成前会运行 `PRAGMA integrity_check` 并核对关键业务表；失败时自动回滚并停止继续写入，启动错误中会显示备份路径。

### 处理快照与彻底清空

每次处理完成后会生成带 `snapshotId` 的不可变快照。页面看板、页面明细和 XLSX 导出优先读取同一个 `reportDate + runId` 快照；导出前若发现看板与明细严重不一致，将停止导出。

“彻底清空全部业务数据”需要两次确认，第二次必须输入“彻底清空”。系统先生成 `backup_before_full_clear_*.db`，备份成功后才在事务中清空日报、扫描、轨迹、结果、POD锁、跨日遗留、历史摘要、断点、快照和导出记录。门店CP码与 CE 登录 token 保留。

完整回归审计可运行：

```powershell
node tools/full_audit_test.mjs
```

## 3. 日常使用

```text
1. 导入长期备份JSON（可选）
2. 导入日报Excel
3. 点击开始全自动处理
4. 等完成
5. 导出XLSX
6. 导出长期备份JSON
```

## 4. 目前已接入的 CE API

订单扫描：

```text
POST /api/otwms/order/confirm-query
body: { shipmentCodes: [...] }
orderStatus=85 => 已签收POD
```

轨迹查询：

```text
POST /api/tms-shipment-event/query
body: ["TBKH0001", "CC..."]
```

已确认该接口支持批量数组返回，并且返回字段包括：

```text
shipmentCode
eventCode
trackingEventCode
trackingEventDesc
trackingEventDescZh
eventTime
operator
eventCourier
place
```

## 5. 为什么独立版会更稳

浏览器脚本和 OTWMS 页面在同一个线程里运行。  
当长期JSON、轨迹节点、Excel导出数据很大时，OTWMS页面会无响应。

独立版把所有计算放在本地 Node 服务里，页面只负责导入、登录、开始处理和导出，不再承载几十万行数据。
