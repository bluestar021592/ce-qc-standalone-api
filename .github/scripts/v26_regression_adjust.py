from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)

# Keep small per-bill status maps in the compact SHOPEE runtime JSON. They are
# required to resume without repeating already completed zero-event API queries.
p = Path('src/businessStore.js')
text = p.read_text(encoding='utf-8')
old = """    scanResults: [],
    scanQueryStatus: [],
    shipmentTrackResults: [],
    shipmentQueryStatus: [],
    trackEvents: [],
    eventQueryStatus: [],
    exceptionItems: [],
    exceptionQueryStatus: [],
    apiBatchStatus: [],
"""
new = """    scanResults: [],
    scanQueryStatus: (state.scanQueryStatus || []).map(stripHeavyBusinessRow),
    shipmentTrackResults: [],
    shipmentQueryStatus: (state.shipmentQueryStatus || []).map(stripHeavyBusinessRow),
    trackEvents: [],
    eventQueryStatus: (state.eventQueryStatus || []).map(stripHeavyBusinessRow),
    exceptionItems: [],
    exceptionQueryStatus: (state.exceptionQueryStatus || []).map(stripHeavyBusinessRow),
    apiBatchStatus: [],
"""
text = replace_once(text, old, new, 'compact resume statuses')
p.write_text(text, encoding='utf-8')

# V25 originally required trackResults to remain in business_states JSON. V26
# deliberately moves them out; final/evidence rows remain recoverable from SQLite.
p = Path('test/v25-shopee-large-state.test.js')
text = p.read_text(encoding='utf-8')
text = replace_once(text,
"""  assert.equal(loaded.trackEvents.length, 120);
  assert.equal(loaded.trackResults.length, 3);
  assert.equal(loaded.finalRows.length, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.trackResults[0], 'rawJson'), false);
""",
"""  assert.equal(loaded.trackEvents.length, 120);
  assert.equal(loaded.trackResults.length, 0);
  assert.equal(loaded.finalRows.length, 3);
  assert.equal(Object.prototype.hasOwnProperty.call(loaded.finalRows[0], 'rawJson'), false);
""",
'V25 trackResults expectation')
p.write_text(text, encoding='utf-8')

print('V26 regression adjustment applied')
