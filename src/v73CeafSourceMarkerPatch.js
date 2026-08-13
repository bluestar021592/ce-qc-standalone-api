import XLSX from 'xlsx';

const PATCH_ID = '2026-08-13-v73-ceaf-source-marker-v1';
const WRAPPED = Symbol.for('ce-qc.v73-ceaf-source-marker');

const SHIPMENT_HEADERS = new Set([
  '运单号', '运单编号', '单号', '面单号', '快递单号', '物流单号',
  'waybill', 'waybillno', 'waybillnumber', 'trackingno', 'trackingnumber', 'shipmentcode'
].map(normalizeHeader));

const CUSTOMER_HEADERS = new Set([
  '客户名称', '客户名', '客户', 'customername', 'customer', 'clientname'
].map(normalizeHeader));

function normalizeHeader(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase().replace(/[\s_\-]+/g, '');
}

function normalizeBusinessToken(value) {
  return String(value ?? '').normalize('NFKC').toUpperCase().replace(/[\s_\-]+/g, '');
}

function isAirMarker(value) {
  const token = normalizeBusinessToken(value);
  return token === 'CCAF' || token === 'CEAF';
}

function patchMatrix(matrix) {
  if (!Array.isArray(matrix) || !matrix.length) return matrix;

  let headerIndex = -1;
  for (let index = 0; index < Math.min(matrix.length, 30); index += 1) {
    const row = Array.isArray(matrix[index]) ? matrix[index] : [];
    if (row.some(value => SHIPMENT_HEADERS.has(normalizeHeader(value)))) {
      headerIndex = index;
      break;
    }
  }
  if (headerIndex < 0) return matrix;

  const header = matrix[headerIndex] ||= [];
  let customerIndex = header.findIndex(value => CUSTOMER_HEADERS.has(normalizeHeader(value)));
  if (customerIndex < 0) {
    customerIndex = header.length;
    header[customerIndex] = '客户名称';
  }

  let airRows = 0;
  for (let index = headerIndex + 1; index < matrix.length; index += 1) {
    const row = Array.isArray(matrix[index]) ? matrix[index] : [];
    if (!row.some(isAirMarker)) continue;
    row[customerIndex] = 'CCAF';
    airRows += 1;
  }

  if (airRows > 0) {
    Object.defineProperty(matrix, '__ceQcV73CeafRows', {
      value: airRows,
      configurable: true,
      enumerable: false
    });
  }
  return matrix;
}

const originalSheetToJson = XLSX.utils.sheet_to_json;
if (typeof originalSheetToJson === 'function' && !originalSheetToJson[WRAPPED]) {
  const wrappedSheetToJson = function v73CeafSheetToJson(sheet, options = {}) {
    const result = originalSheetToJson.call(this, sheet, options);
    if (options?.header === 1) patchMatrix(result);
    return result;
  };
  Object.defineProperty(wrappedSheetToJson, WRAPPED, { value: true });
  XLSX.utils.sheet_to_json = wrappedSheetToJson;
}

export const V73_CEAF_SOURCE_MARKER_PATCH_ID = PATCH_ID;
export const __test = { patchMatrix, isAirMarker };
