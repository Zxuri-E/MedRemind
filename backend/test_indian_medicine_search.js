import assert from 'node:assert';
import { app } from './server.js';
import http from 'http';
import { searchIndianMedicines } from '../src/utils/indianMedicineService.js';

console.log('========================================================================');
console.log('MEDREMIND INDIAN MEDICINES RELEVANCE & PRICE EXCLUSION TEST SUITE');
console.log('========================================================================\n');

let server;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve();
    });
  });
}

function stopServer() {
  if (server) server.close();
}

async function runTests() {
  await startServer();
  let passed = 0;

  try {
    // 1. Backend Search Limits and Price Exclusion
    console.log('--- 1. BACKEND API RANKING & PRICE EXCLUSION ---');
    const res = await fetch(`${baseUrl}/api/indian-medicines?search=Dolo`);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.ok(Array.isArray(data.medicines));
    assert.ok(data.medicines.length <= 5, `Expected <= 5 results, got ${data.medicines.length}`);

    // Verify absolutely NO price or price_inr in any returned medicine
    for (const med of data.medicines) {
      assert.strictEqual(med.price, undefined, `Medicine ${med.brand} must NOT contain price`);
      assert.strictEqual(med.price_inr, undefined, `Medicine ${med.brand} must NOT contain price_inr`);
      assert.ok(med.brand, 'Must have brand name');
      assert.ok(med.generic, 'Must have generic name');
    }
    console.log(`  [PASS] Returned ${data.medicines.length} top results for "Dolo" strictly without price fields`);
    passed++;

    // 2. Exact Match Ranking Verification
    const resExact = await fetch(`${baseUrl}/api/indian-medicines?search=Dolo%20650`);
    const dataExact = await resExact.json();
    assert.ok(dataExact.medicines.length > 0);
    assert.strictEqual(dataExact.medicines[0].brand, 'Dolo 650 Tablet', 'Exact brand must be ranked #1');
    console.log('  [PASS] Exact match "Dolo 650 Tablet" is ranked #1 in search results');
    passed++;

    // 3. Client-side Search Service Verification
    console.log('\n--- 2. CLIENT SERVICE IN-MEMORY RELEVANCE & SANITIZATION ---');
    const clientResults = await searchIndianMedicines('Augmentin', 5);
    assert.ok(Array.isArray(clientResults));
    assert.ok(clientResults.length <= 5, `Expected <= 5 results, got ${clientResults.length}`);

    for (const med of clientResults) {
      assert.strictEqual(med.price, undefined, `Client result ${med.brand} must not contain price`);
      assert.strictEqual(med.price_inr, undefined, `Client result ${med.brand} must not contain price_inr`);
    }
    console.log(`  [PASS] Client search returned ${clientResults.length} sanitized, top-ranked matches for "Augmentin"`);
    passed++;

    console.log('\n========================================================================');
    console.log(`INDIAN MEDICINE SEARCH VERIFICATION: ${passed} TESTS PASSED`);
    console.log('========================================================================\n');
    stopServer();
    process.exit(0);
  } finally {
    stopServer();
  }
}

runTests().catch(err => {
  console.error('[TEST ERROR]:', err);
  stopServer();
  process.exit(1);
});
