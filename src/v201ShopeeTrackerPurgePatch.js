import { BUSINESS_DATA_TABLES } from './store.js';

export const V201_SHOPEE_TRACKER_PURGE_PATCH = '2026-08-18-v201-shopee-tracker-purge-v1';
for (const table of ['shopee_delivery_tracking', 'shopee_delivery_tracking_daily']) {
  if (!BUSINESS_DATA_TABLES.includes(table)) BUSINESS_DATA_TABLES.push(table);
}
