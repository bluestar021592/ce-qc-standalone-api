你要继续开发这个项目：CE 金边仓质控独立API版。

业务目标：
1. 用户导入 CE 日报 Excel。
2. 用户导入长期 JSON 备份。
3. 系统合并 今日PNH + 跨日遗留。
4. 调用 OTWMS 订单扫描接口：
   POST /api/otwms/order/confirm-query
   body: { shipmentCodes: [...] }
   orderStatus=85 判定为已签收POD。
5. 非POD单号进入轨迹池。
6. 调用轨迹接口：
   POST /api/tms-shipment-event/query
   body: ["WB1","WB2",...]
   该接口支持批量数组。
7. 按轨迹节点判断 POD / Pending / OC / 盘点 / 派件分配 / 派送停留 / 入库无扫描。
8. 导出 XLSX，总表和明细必须清楚。
9. 不依赖网页DOM，不读取页面表格。

重点优化：
- UI做得更适合质控日常操作。
- Excel解析规则需要根据 CE 日报真实列名继续增强。
- 长期JSON提取旧跨日逻辑继续加强。
- 异常分类口径按用户项目记忆保持：
  SPE/WHPP排除；
  CEZT/CECN/580/门店最终停留不算普通异常；
  中途到过CEZT/CECN后又回CCSL继续派送，要继续判断后续轨迹。
- 导出时不要再重复跑大批API，避免卡顿。
