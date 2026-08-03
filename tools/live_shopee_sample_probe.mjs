import { CEClient } from '../src/ceClient.js';
import { analyzeShopeeShipment } from '../src/shopeeAnalyzer.js';

const bills = [
  'SPE260706000157',
  'SPE260705000370',
  'SPE260706000491',
  'SPE260714000975',
  'SPE260713000655'
];

const client = new CEClient();

try {
  const [shipmentRows, eventRows, exceptionRows] = await Promise.all([
    client.shipmentTrack(bills),
    client.trackQuery(bills),
    client.exceptionQuery(bills)
  ]);
  const shipmentByBill = group(shipmentRows);
  const eventsByBill = group(eventRows);
  const exceptionsByBill = group(exceptionRows);
  const samples = bills.map(shipmentCode => {
    const shipmentTrackRow = shipmentByBill.get(shipmentCode)?.[0] || {};
    const events = eventsByBill.get(shipmentCode) || [];
    const exceptions = exceptionsByBill.get(shipmentCode) || [];
    const current = analyzeShopeeShipment({
      waybill: shipmentCode,
      shipmentTrackRow,
      events,
      exceptions,
      reportDate: '2026-07-20',
      apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
    });
    const result = {
      shipmentCode,
      shipmentRows: shipmentByBill.get(shipmentCode)?.length || 0,
      eventCount: events.length,
      exceptionCount: exceptions.length,
      category: current.primaryCategory,
      regionCode: current.regionCode,
      pendingCurrent: current.Pending当前次数,
      pendingMax: current.Pending最大次数,
      ocDays: current.OC天数,
      returnStatus: current.退回状态,
      returnPhotoStatus: current.退回照片状态,
      podStatus: current.POD状态,
      carryStatus: current.carry状态
    };
    if (shipmentCode === 'SPE260713000655') {
      const day1 = analyzeShopeeShipment({
        waybill: shipmentCode,
        shipmentTrackRow: {},
        events,
        exceptions,
        reportDate: '2026-07-19',
        apiStatus: { shipment: 'success', event: 'success', exception: 'success' }
      });
      result.day1Category = day1.primaryCategory;
      result.day1CarryStatus = day1.carry状态;
    }
    return result;
  });
  console.log(JSON.stringify({ ok: true, requested: bills.length, shipmentRows: shipmentRows.length, eventRows: eventRows.length, exceptionRows: exceptionRows.length, samples }, null, 2));
} catch (error) {
  console.log(JSON.stringify({
    ok: false,
    error: error.message || String(error),
    ceStatus: error.ceStatus || '',
    ceCode: error.ceCode || '',
    ceMsg: error.ceMsg || ''
  }, null, 2));
  process.exitCode = 1;
}

function group(rows = []) {
  const map = new Map();
  for (const row of rows || []) {
    const bill = String(row?.shipmentCode || row?.运单号 || '').trim().toUpperCase();
    if (!bill) continue;
    if (!map.has(bill)) map.set(bill, []);
    map.get(bill).push(row);
  }
  return map;
}
