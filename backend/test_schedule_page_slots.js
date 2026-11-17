import assert from 'node:assert';
import { 
  getMedicineTimings, 
  getSlotNameForTime, 
  isMedicineInSlot, 
  isMedicineActiveOnDate, 
  getMedicineStartDate,
  parseArbitraryTime
} from '../src/utils/scheduleSlotUtils.js';

console.log('========================================================================');
console.log('MEDREMIND SCHEDULE PAGE SLOTS & TIMINGS VERIFICATION SUITE');
console.log('========================================================================\n');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  [FAIL] ${name}:`, err.message);
    process.exit(1);
  }
}

// 1. Slot Name Mapping for various time strings
test('1.1 Standard 12-hour AM/PM formats map to correct slots', () => {
  assert.strictEqual(getSlotNameForTime('08:00 AM'), 'Morning');
  assert.strictEqual(getSlotNameForTime('8:00 AM'), 'Morning');
  assert.strictEqual(getSlotNameForTime('01:00 PM'), 'Afternoon');
  assert.strictEqual(getSlotNameForTime('1:00 PM'), 'Afternoon');
  assert.strictEqual(getSlotNameForTime('07:00 PM'), 'Evening');
  assert.strictEqual(getSlotNameForTime('7:00 PM'), 'Evening');
  assert.strictEqual(getSlotNameForTime('10:00 PM'), 'Night');
  assert.strictEqual(getSlotNameForTime('11:30 PM'), 'Night');
});

test('1.2 24-hour formats map to correct slots', () => {
  assert.strictEqual(getSlotNameForTime('08:00'), 'Morning');
  assert.strictEqual(getSlotNameForTime('09:30'), 'Morning');
  assert.strictEqual(getSlotNameForTime('13:00'), 'Afternoon');
  assert.strictEqual(getSlotNameForTime('15:45'), 'Afternoon');
  assert.strictEqual(getSlotNameForTime('19:00'), 'Evening');
  assert.strictEqual(getSlotNameForTime('20:15'), 'Evening');
  assert.strictEqual(getSlotNameForTime('22:00'), 'Night');
  assert.strictEqual(getSlotNameForTime('23:00'), 'Night');
  assert.strictEqual(getSlotNameForTime('01:00'), 'Night');
});

test('1.3 Named slots & parenthesized times map to correct slots', () => {
  assert.strictEqual(getSlotNameForTime('Morning (8:00 AM)'), 'Morning');
  assert.strictEqual(getSlotNameForTime('Afternoon (1:00 PM)'), 'Afternoon');
  assert.strictEqual(getSlotNameForTime('Evening (7:00 PM)'), 'Evening');
  assert.strictEqual(getSlotNameForTime('Night (10:00 PM)'), 'Night');
});

// 2. Medicine Timings extraction
test('2.1 Medicine with timeSlots array gathers all timings', () => {
  const med = { timeSlots: ['08:00 AM', '08:00 PM'], status: 'Active' };
  const timings = getMedicineTimings(med);
  assert.deepStrictEqual(timings, ['08:00 AM', '08:00 PM']);
});

test('2.2 Medicine with times array gathers all timings', () => {
  const med = { times: ['08:00', '14:00', '20:00'], status: 'Active' };
  const timings = getMedicineTimings(med);
  assert.deepStrictEqual(timings, ['08:00', '14:00', '20:00']);
});

test('2.3 Medicine with OCR flags (morningDose, nightDose) generates slots', () => {
  const med = { morningDose: 1, nightDose: 1, status: 'Active' };
  const timings = getMedicineTimings(med);
  assert.ok(timings.some(t => t.includes('Morning')));
  assert.ok(timings.some(t => t.includes('Night')));
});

test('2.4 Medicine with no timings falls back gracefully to Morning', () => {
  const med = { name: 'Unknown Timing Med', status: 'Active' };
  const timings = getMedicineTimings(med);
  assert.deepStrictEqual(timings, ['Morning (8:00 AM)']);
});

// 3. Slot membership checking
test('3.1 isMedicineInSlot correctly matches medicines in their target slots', () => {
  const cipro = { name: 'Ciprofloxacin', timeSlots: ['Morning (8:00 AM)'], status: 'Active' };
  const domperidone = { name: 'Domperidone', timeSlots: ['08:00 AM'], status: 'Active' };
  const paracetamol = { name: 'Paracetamol', times: ['14:00'], status: 'Active' };
  const antacid = { name: 'Antacid', times: ['19:30'], status: 'Active' };
  const multivitamin = { name: 'Multivitamin', timeSlots: ['10:00 PM'], status: 'Active' };

  assert.strictEqual(isMedicineInSlot(cipro, 'Morning'), true);
  assert.strictEqual(isMedicineInSlot(domperidone, 'Morning'), true);
  assert.strictEqual(isMedicineInSlot(cipro, 'Afternoon'), false);

  assert.strictEqual(isMedicineInSlot(paracetamol, 'Afternoon'), true);
  assert.strictEqual(isMedicineInSlot(paracetamol, 'Morning'), false);

  assert.strictEqual(isMedicineInSlot(antacid, 'Evening'), true);
  assert.strictEqual(isMedicineInSlot(antacid, 'Night'), false);

  assert.strictEqual(isMedicineInSlot(multivitamin, 'Night'), true);
  assert.strictEqual(isMedicineInSlot(multivitamin, 'Morning'), false);
});

// 4. Calendar Date Active Filtering
test('4.1 Active medicine is visible on today', () => {
  const todayStr = new Date().toISOString().split('T')[0];
  const med = { 
    id: `med-${Date.now()}`, 
    status: 'Active', 
    startDate: todayStr 
  };
  assert.strictEqual(isMedicineActiveOnDate(med, todayStr), true);
});

test('4.2 Active medicine is visible on future dates', () => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().split('T')[0];

  const med = { 
    id: `med-${Date.now()}`, 
    status: 'Active', 
    startDate: todayStr 
  };
  assert.strictEqual(isMedicineActiveOnDate(med, tomorrowStr), true);
});

test('4.3 Active medicine is NOT visible on past dates before its start date', () => {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];

  const med = { 
    id: `med-${Date.now()}`, 
    status: 'Active', 
    startDate: todayStr 
  };
  assert.strictEqual(isMedicineActiveOnDate(med, yesterdayStr), false);
});

test('4.4 Medicine with past end date is not visible', () => {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const todayStr = today.toISOString().split('T')[0];

  const med = { 
    id: `med-${Date.now()}`, 
    status: 'Active', 
    startDate: '2026-11-01',
    endDate: yesterdayStr 
  };
  assert.strictEqual(isMedicineActiveOnDate(med, todayStr), false);
});

console.log(`\n========================================================================`);
console.log(`SCHEDULE PAGE VERIFICATION: ${passed} TESTS PASSED`);
console.log(`========================================================================\n`);
