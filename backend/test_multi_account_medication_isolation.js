/**
 * Test Suite: Multi-Account Medication Isolation & Logout Lifecycle Verification
 * 
 * Verifies:
 * 1. Account A adds medicines -> persisted under Account A's scope.
 * 2. Account A logs out -> in-memory data resets, legacy unscoped cache cleared.
 * 3. Account B registers fresh -> starts with strictly 0 medicines, empty routine.
 * 4. Account B adds dosages -> persisted under Account B's scope.
 * 5. Account switching preserves strict account isolation without data leakage.
 */

import './setup_test_env.js';
import assert from 'assert';

console.log('========================================================================');
console.log('MEDREMIND MULTI-ACCOUNT MEDICATION ISOLATION VERIFICATION SUITE');
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

// Simulated isolated storage and lifecycle manager matching MedicineContext + AuthContext
class AccountSessionManager {
  constructor() {
    this.currentUser = null;
    this.inMemoryMeds = [];
    this.inMemoryLogs = {};
    this.inMemoryProfile = null;
  }

  register(userId, name, email) {
    // When a new account registers, wipe any legacy un-scoped cache
    localStorage.removeItem('medremind_medicines');
    localStorage.removeItem('medremind_dose_logs');
    localStorage.removeItem('medremind_patient_profile');

    this.currentUser = { id: userId, name, email };
    // MedicineContext effect triggers:
    this.loadUserData(userId);
  }

  login(userId, name, email) {
    this.currentUser = { id: userId, name, email };
    this.loadUserData(userId);
  }

  logout() {
    this.currentUser = null;
    localStorage.removeItem('medremind_auth_user');
    localStorage.removeItem('medremind_auth_token');
    localStorage.removeItem('medremind_medicines');
    localStorage.removeItem('medremind_dose_logs');
    localStorage.removeItem('medremind_patient_profile');

    // MedicineContext cleans in-memory state on logout
    this.inMemoryMeds = [];
    this.inMemoryLogs = {};
    this.inMemoryProfile = null;
  }

  loadUserData(userId) {
    if (!userId) {
      this.inMemoryMeds = [];
      this.inMemoryLogs = {};
      this.inMemoryProfile = null;
      return;
    }

    const saved = localStorage.getItem(`medremind_medicines_${userId}`);
    if (saved) {
      this.inMemoryMeds = JSON.parse(saved);
    } else {
      this.inMemoryMeds = [];
    }

    const savedLogs = localStorage.getItem(`medremind_dose_logs_${userId}`);
    this.inMemoryLogs = savedLogs ? JSON.parse(savedLogs) : {};

    const savedProfile = localStorage.getItem(`medremind_patient_profile_${userId}`);
    this.inMemoryProfile = savedProfile ? JSON.parse(savedProfile) : { name: this.currentUser?.name, email: this.currentUser?.email };
  }

  addMedicine(name, dosage, times) {
    if (!this.currentUser) throw new Error('Cannot add medicine when logged out');
    const newMed = {
      id: `med-${Date.now()}-${Math.random()}`,
      userId: this.currentUser.id,
      name,
      dosage,
      times,
      timeSlots: times,
      status: 'Active'
    };
    this.inMemoryMeds.unshift(newMed);

    // Save to user-scoped key
    localStorage.setItem(`medremind_medicines_${this.currentUser.id}`, JSON.stringify(this.inMemoryMeds));
    // Mirror to active key
    localStorage.setItem('medremind_medicines', JSON.stringify(this.inMemoryMeds));
    return newMed;
  }
}

const manager = new AccountSessionManager();

// Test 1: User A registers and adds medicines
runTest('1.1 User A registers and adds medications to schedule', () => {
  manager.register('USR-A-001', 'Alice User', 'alice@test.com');
  assert.strictEqual(manager.inMemoryMeds.length, 0, 'New user must start with 0 medications');

  manager.addMedicine('Ciprofloxacin', '500mg', ['Morning (8:00 AM)']);
  manager.addMedicine('Domperidone', '20mg', ['Morning (8:00 AM)', 'Night (10:00 PM)']);

  assert.strictEqual(manager.inMemoryMeds.length, 2);
  assert.strictEqual(manager.inMemoryMeds[0].userId, 'USR-A-001');
  assert.strictEqual(manager.inMemoryMeds[1].userId, 'USR-A-001');

  const storedA = JSON.parse(localStorage.getItem('medremind_medicines_USR-A-001'));
  assert.strictEqual(storedA.length, 2);
});

// Test 2: User A logs out
runTest('2.1 User A logs out: state and un-scoped storage are wiped', () => {
  manager.logout();
  assert.strictEqual(manager.currentUser, null);
  assert.strictEqual(manager.inMemoryMeds.length, 0, 'In-memory medicines must be cleared on logout');
  assert.strictEqual(localStorage.getItem('medremind_medicines'), null, 'Global key must be cleared on logout');
  
  // Account A data remains securely saved under Account A's key
  assert.ok(localStorage.getItem('medremind_medicines_USR-A-001'), 'User A data must persist in user key');
});

// Test 3: User B registers fresh
runTest('3.1 User B registers: starts with strictly 0 medicines, not User A data', () => {
  manager.register('USR-B-002', 'Bob User', 'bob@test.com');
  assert.strictEqual(manager.currentUser.id, 'USR-B-002');
  assert.strictEqual(manager.inMemoryMeds.length, 0, 'User B must NOT inherit User A medications!');

  const storedB = localStorage.getItem('medremind_medicines_USR-B-002');
  assert.strictEqual(storedB, null, 'User B must have no initial medications stored');
});

// Test 4: User B adds their own medicine
runTest('4.1 User B adds their own medication without contamination', () => {
  manager.addMedicine('Paracetamol', '650mg', ['Afternoon (1:00 PM)']);
  assert.strictEqual(manager.inMemoryMeds.length, 1);
  assert.strictEqual(manager.inMemoryMeds[0].name, 'Paracetamol');
  assert.strictEqual(manager.inMemoryMeds[0].userId, 'USR-B-002');

  const storedB = JSON.parse(localStorage.getItem('medremind_medicines_USR-B-002'));
  assert.strictEqual(storedB.length, 1);
  assert.strictEqual(storedB[0].name, 'Paracetamol');
});

// Test 5: Switch back to User A
runTest('5.1 Logging back into User A restores User A medications without User B', () => {
  manager.logout();
  assert.strictEqual(manager.inMemoryMeds.length, 0);

  manager.login('USR-A-001', 'Alice User', 'alice@test.com');
  assert.strictEqual(manager.inMemoryMeds.length, 2, 'User A medicines restored');
  assert.strictEqual(manager.inMemoryMeds.some(m => m.name === 'Paracetamol'), false, 'User B med must NOT exist in User A');
  assert.strictEqual(manager.inMemoryMeds.some(m => m.name === 'Ciprofloxacin'), true);
});

console.log('\n========================================================================');
console.log(`MULTI-ACCOUNT ISOLATION TESTS: ${passedTests}/${totalTests} PASSED`);
console.log('========================================================================');
