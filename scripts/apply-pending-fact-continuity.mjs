import fs from 'node:fs';

const file = 'src/analyzerV30.js';
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(before, after, label) {
  if (source.includes(after)) return;
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected exactly one match, got ${count}`);
  source = source.replace(before, after);
}

replaceOnce(
`  const storeFlow = facts.storeFlow;
  const pending = pendingTail(sorted, last);
  const cycle = cycleTail(sorted, last, reportDate);`,
`  const storeFlow = facts.storeFlow;
  // Pending business facts come from the trajectory fact layer: all distinct
  // Pending calendar dates are de-duplicated there, and continuity is calculated
  // from those dates. The old pendingTail() only counted the final adjacent run of
  // event-code 150 and lost an earlier Pending date whenever another valid event
  // appeared in between.
  const pending = pendingFromFacts(facts, lastCode);
  const cycle = cycleTail(sorted, last, reportDate);`,
'use trajectory facts for Pending dates'
);

replaceOnce(
`function pendingTail(events, last) {
  if (!last || codeOf(last) !== TRACK.PENDING) return { days: 0, dates: [], continuous: false };
  const tail = [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (codeOf(events[index]) !== TRACK.PENDING) break;
    tail.push(events[index]);
  }
  const dates = distinctDates(tail);
  return { days: Math.max(1, dates.length), dates, continuous: consecutive(dates) };
}

function cycleTail(events, last, reportDate) {`,
`function pendingFromFacts(facts = {}, lastCode = '') {
  if (String(lastCode || '') !== TRACK.PENDING) return { days: 0, dates: [], continuous: false };
  const dates = [...new Set((facts.pendingDates || []).map(String).filter(Boolean))].sort();
  const days = Math.max(1, dates.length);
  return {
    days,
    dates,
    continuous: dates.length <= 1 ? true : Boolean(facts.pendingDateContinuity)
  };
}

function cycleTail(events, last, reportDate) {`,
'replace Pending tail helper with fact helper'
);

fs.writeFileSync(file, source, 'utf8');
