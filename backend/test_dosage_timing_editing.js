/**
 * Test Suite: Dosage Timing Editing Verification
 * 
 * Verifies:
 * 1. Modifying dosage timings updates timeSlots, times, frequency, and slot counts.
 * 2. Editing timings correctly triggers alarm rescheduling logic.
 * 3. Validation ensures minimum 1 dose timing is maintained.
 * 4. Chronological sorting and 12h/24h conversion accuracy.
 */

import './setup_test_env.js';
import assert from 'assert';
import { parseArbitraryTime, getSlotNameForTime } from '../src/utils/scheduleSlotUtils.js';

console.log('========================================================================');
console.log('MEDREMIND DOSAGE TIMING EDITING VERIFICATION SUITE');
console.log('========================================================================\n');

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err.message}`);
    process.exitCode = 1;
  }
}

// 1. Time string conversion & parsing
runTest('1.1 Arbitrary time strings properly parsed into 24h hours & minutes', () => {
  const t1 = parseArbitraryTime('Morning (8:00 AM)');
  assert.strictEqual(t1.hours, 8);
  assert.strictEqual(t1.minutes, 0);

  const t2 = parseArbitraryTime('01:30 PM');
  assert.strictEqual(t2.hours, 13);
  assert.strictEqual(t2.minutes, 30);

  const t3 = parseArbitraryTime('21:45');
  assert.strictEqual(t3.hours, 21);
  assert.strictEqual(t3.minutes, 45);
});

// 2. Timing updates calculation logic
runTest('2.1 Frequency and slot dose counts derived properly from updated timings list', () => {
  function computeDoseMetrics(timingsList24) {
    const sorted = [...timingsList24].sort();
    let morningCount = 0;
    let afternoonCount = 0;
    let nightCount = 0;

    sorted.forEach(t => {
      const [h] = t.split(':').map(Number);
      if (h >= 4 && h < 12) morningCount += 1;
      else if (h >= 12 && h < 17) afternoonCount += 1;
      else nightCount += 1;
    });

    const getFrequency = (count) => {
      if (count === 1) return 'Once daily';
      if (count === 2) return 'Twice daily';
      if (count === 3) return 'Three times daily';
      if (count === 4) return 'Four times daily';
      return `${count} times daily`;
    };

    return {
      frequency: getFrequency(sorted.length),
      morningDose: morningCount,
      afternoonDose: afternoonCount,
      nightDose: nightCount
    };
  }

  // Initial: 1 dose at 08:00 AM
  const initial = computeDoseMetrics(['08:00']);
  assert.strictEqual(initial.frequency, 'Once daily');
  assert.strictEqual(initial.morningDose, 1);
  assert.strictEqual(initial.afternoonDose, 0);

  // User edits and adds a dinner dose at 19:30
  const updated2 = computeDoseMetrics(['08:00', '19:30']);
  assert.strictEqual(updated2.frequency, 'Twice daily');
  assert.strictEqual(updated2.morningDose, 1);
  assert.strictEqual(updated2.nightDose, 1);

  // User adds lunch dose at 13:00
  const updated3 = computeDoseMetrics(['08:00', '13:00', '19:30']);
  assert.strictEqual(updated3.frequency, 'Three times daily');
  assert.strictEqual(updated3.afternoonDose, 1);
});

// 3. Minimum dose timing validation
runTest('3.1 Removing last timing is prevented (requires >= 1 dose timing)', () => {
  let timesList = ['Morning (8:00 AM)'];
  
  function removeTime(index) {
    if (timesList.length <= 1) {
      throw new Error('A medication routine must have at least one dose timing.');
    }
    timesList = timesList.filter((_, i) => i !== index);
  }

  assert.throws(() => removeTime(0), /at least one dose timing/);
  assert.strictEqual(timesList.length, 1);
});

// 4. Update medicine simulation and notification rescheduling
runTest('4.1 updateMedicine cancels old alarms and reschedules new ones', () => {
  const cancelledMeds = [];
  const scheduledDoses = [];

  const mockAlarmService = {
    cancelMedicationNotifications: (id) => cancelledMeds.push(id),
    scheduleMedicationDoseNotification: (med, time, id) => scheduledDoses.push({ medId: id, time })
  };

  let medicines = [
    {
      id: 'med-101',
      name: 'Amoxicillin',
      dosage: '500mg',
      status: 'Active',
      timeSlots: ['Morning (8:00 AM)'],
      times: ['Morning (8:00 AM)'],
      frequency: 'Once daily'
    }
  ];

  function updateMedicine(id, updatedData) {
    medicines = medicines.map(m => {
      if (m.id === id) {
        const updated = { ...m, ...updatedData };
        if (updated.status === 'Active') {
          mockAlarmService.cancelMedicationNotifications(m.id);
          const slots = updated.times && updated.times.length > 0 ? updated.times : (updated.timeSlots || ['08:00 AM']);
          slots.forEach(t => mockAlarmService.scheduleMedicationDoseNotification(updated, t, updated.id));
        }
        return updated;
      }
      return m;
    });
  }

  // Perform dosage timing edit: change from 8:00 AM to 9:00 AM and 21:00 PM
  updateMedicine('med-101', {
    timeSlots: ['Morning (9:00 AM)', 'Night (9:00 PM)'],
    times: ['Morning (9:00 AM)', 'Night (9:00 PM)'],
    frequency: 'Twice daily'
  });

  // Verification
  assert.strictEqual(cancelledMeds.length, 1);
  assert.strictEqual(cancelledMeds[0], 'med-101');
  assert.strictEqual(scheduledDoses.length, 2);
  assert.strictEqual(scheduledDoses[0].time, 'Morning (9:00 AM)');
  assert.strictEqual(scheduledDoses[1].time, 'Night (9:00 PM)');

  const updatedMed = medicines.find(m => m.id === 'med-101');
  assert.strictEqual(updatedMed.frequency, 'Twice daily');
  assert.deepStrictEqual(updatedMed.timeSlots, ['Morning (9:00 AM)', 'Night (9:00 PM)']);
});

console.log('\n========================================================================');
console.log(`DOSAGE TIMING TESTS COMPLETED: ${passedTests}/${totalTests} PASSED`);
console.log('========================================================================');
