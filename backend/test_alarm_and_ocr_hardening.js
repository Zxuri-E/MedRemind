/**
 * Automated Verification Suite for User Issues:
 * 1. Deactivated medicines must never ring while deactivated.
 * 2. Stopped alarms must never start ringing again when entering the app.
 * 3. Alarm notifications must provide immediate stop/dismiss capability.
 * 4. OCR must reject directions like "bath", "rinse", "gargle", and strip trailing noise keywords.
 */

import './setup_test_env.js';
import { extractMedicationsFromText } from '../src/services/clientOcrService.js';
import { 
  cleanPrescriptionMedicineName, 
  isInstructionOrNonMedLine, 
  resolveBrandAndGeneric 
} from '../src/utils/drugKnowledgeBase.js';
import { alarmService } from '../src/services/alarmService.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

console.log('========================================================================');
console.log('MEDREMIND ISSUE VERIFICATION: ALARM RELIABILITY & OCR HARDENING');
console.log('========================================================================\n');

// -------------------------------------------------------------
// TEST SUITE 1: OCR KEYWORD FILTERING & SANITIZATION
// -------------------------------------------------------------
console.log('--- SUITE 1: OCR INSTRUCTION FILTERING & NOISE SANITIZATION ---');

// 1.1 Non-medication direction lines must be rejected completely
const instructionLines = [
  'Warm salt water gargle twice daily',
  'Rinse mouth with water after brushing',
  'Take warm sponge bath once daily',
  'Wash affected area and keep clean',
  'Apply soothing lotion after bath',
  'Drink plenty of warm fluids and take bed rest',
  'BP: 120/80 mmHg, Pulse: 72/min',
  'Review after 5 days with test reports'
];

for (const line of instructionLines) {
  assert(isInstructionOrNonMedLine(line) === true, `Instruction line rejected: "${line}"`);
}

// 1.2 Prescription with mixed medication and instruction lines
const prescriptionWithNoise = `
Dr. R. Sharma MD
Date: 17/11/2026
Patient: Aryan Age: 16

1. Tab Ciprofioxacin 500mg After F bi
2. B Dompendone Rabeprazole 20m Batre Most Deve
3. Warm water gargle twice daily
4. Rinse mouth after meals
5. Sponge bath daily with lukewarm water
6. Tab Paracetamol 650mg 1-0-1 x 3 days
`;

const extracted = extractMedicationsFromText(prescriptionWithNoise);

assert(extracted.length === 3, `Extracted exactly 3 medicines (instructions excluded), got ${extracted.length}`);

// Verify that gargle, rinse, bath were NOT extracted
const anyInstructionExtracted = extracted.some(m => 
  /bath|rinse|gargle|wash|sponge/i.test(m.brandName) || 
  /bath|rinse|gargle|wash|sponge/i.test(m.genericIngredient)
);
assert(!anyInstructionExtracted, 'No hygiene/instruction lines (bath, rinse, gargle) extracted as medicines');

// Verify clean name extraction for Ciprofloxacin
const ciproMed = extracted.find(m => /cipro/i.test(m.genericIngredient) || /cipro/i.test(m.brandName));
assert(!!ciproMed, 'Ciprofloxacin identified from "Ciprofioxacin After F bi"');
if (ciproMed) {
  assert(!ciproMed.brandName.includes('After'), 'Ciprofloxacin brand name does not contain "After"');
  assert(!ciproMed.brandName.includes('bi'), 'Ciprofloxacin brand name does not contain "bi"');
  assert(!ciproMed.brandName.includes('F'), 'Ciprofloxacin brand name does not contain orphan "F"');
}

// Verify clean name extraction for Domperidone + Rabeprazole
const ppiMed = extracted.find(m => /rabeprazole/i.test(m.genericIngredient) || /domperidone/i.test(m.genericIngredient));
assert(!!ppiMed, 'Rabeprazole + Domperidone identified from "B Dompendone Rabeprazole 20m Batre Most Deve"');
if (ppiMed) {
  assert(!ppiMed.brandName.includes('Batre'), 'PPI brand name does not contain "Batre"');
  assert(!ppiMed.brandName.includes('Most'), 'PPI brand name does not contain "Most"');
  assert(!ppiMed.brandName.includes('Deve'), 'PPI brand name does not contain "Deve"');
  assert(!ppiMed.brandName.startsWith('B '), 'PPI brand name does not contain leading orphan "B"');
}

// 1.3 cleanPrescriptionMedicineName unit tests
assert(cleanPrescriptionMedicineName('Tab Ciprofioxacin 500mg After F bi') === 'Ciprofioxacin', 'cleanPrescriptionMedicineName sanitizes "Tab Ciprofioxacin 500mg After F bi" -> "Ciprofioxacin"');
assert(cleanPrescriptionMedicineName('B Dompendone Rabeprazole 20m Batre Most Deve') === 'Dompendone Rabeprazole', 'cleanPrescriptionMedicineName sanitizes "B Dompendone Rabeprazole 20m Batre Most Deve" -> "Dompendone Rabeprazole"');
assert(cleanPrescriptionMedicineName('Rinse mouth with water') === '', 'cleanPrescriptionMedicineName returns empty string for pure instruction line');
assert(cleanPrescriptionMedicineName('Warm sponge bath') === '', 'cleanPrescriptionMedicineName returns empty string for pure hygiene line');

// -------------------------------------------------------------
// TEST SUITE 2: DEACTIVATED MEDICINES ALARM LIFECYCLE
// -------------------------------------------------------------
console.log('\n--- SUITE 2: DEACTIVATED MEDICINES ALARM LIFECYCLE ---');

const testMedId = 'med-test-deact-01';

// Step 2.1 Mark medicine active and schedule alarm
alarmService.setMedicineActive(testMedId, true);
assert(alarmService.isMedicineInactive(testMedId) === false, 'Medicine is initially marked Active');

// Step 2.2 Trigger alarm for active medicine
await alarmService.triggerAlarm({
  alarmId: 'alarm_test_deact_01',
  medicineId: testMedId,
  medicineName: 'Active Antibiotic',
  dosage: '1 tab',
  timeSlot: '08:00 AM'
});

let state = alarmService.getState();
assert(state.isRinging === true, 'Alarm successfully started ringing for Active medicine');

// Step 2.3 Deactivate medicine while alarm is actively ringing
// Non-negotiable requirement: Deactivating medicine must IMMEDIATELY halt any active ringing alarm
alarmService.setMedicineActive(testMedId, false);
assert(alarmService.isMedicineInactive(testMedId) === true, 'Medicine is now marked Inactive');

state = alarmService.getState();
assert(state.isRinging === false, 'Deactivating medicine immediately stopped the active ringing alarm');

// Step 2.4 Attempt to trigger alarm for inactive medicine
await alarmService.triggerAlarm({
  alarmId: 'alarm_test_deact_02',
  medicineId: testMedId,
  medicineName: 'Inactive Antibiotic',
  dosage: '1 tab',
  timeSlot: '08:00 AM'
});

state = alarmService.getState();
assert(state.isRinging === false, 'Triggering alarm for an Inactive medicine is strictly blocked');

// -------------------------------------------------------------
// TEST SUITE 3: STOPPED ALARM DOES NOT RE-RING ON APP ENTER
// -------------------------------------------------------------
console.log('\n--- SUITE 3: STOPPED ALARM NEVER RE-RINGS ON APP ENTRY ---');

const medId2 = 'med-test-re-ring-02';
alarmService.setMedicineActive(medId2, true);

const alarmIdToStop = 'alarm_re_ring_test';
await alarmService.triggerAlarm({
  alarmId: alarmIdToStop,
  medicineId: medId2,
  medicineName: 'Blood Pressure Tablet',
  dosage: '1 tab',
  timeSlot: '09:00 AM'
});

assert(alarmService.getState().isRinging === true, 'Alarm is actively ringing before user stops it');

// User explicitly stops the alarm
await alarmService.stopActiveAlarm('DISMISSED');

assert(alarmService.getState().isRinging === false, 'Alarm stopped after explicit DISMISS');

// Verify persistent "dismissed today" guard
const todayStr = new Date().toISOString().split('T')[0];
assert(alarmService.isDismissedToday(alarmIdToStop, todayStr) === true, 'Alarm is recorded as dismissed for today');

// Simulate user re-entering the app (app resume / visibility change / ticker trigger)
await alarmService.triggerAlarm({
  alarmId: alarmIdToStop,
  medicineId: medId2,
  medicineName: 'Blood Pressure Tablet',
  dosage: '1 tab',
  timeSlot: '09:00 AM'
});

assert(alarmService.getState().isRinging === false, 'Entering app does NOT re-ring the already-stopped alarm');

console.log('\n========================================================================');
console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================================================\n');

if (failed > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
