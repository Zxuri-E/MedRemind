/**
 * MedRemind Indian Government Medical Database Service
 * 
 * Powered by the official Indian pharmaceutical dataset of 250,000+ medicines.
 * Offline-first: Instant in-memory search over top Indian brands + online full dataset search.
 * Optimized for relevance-based search ranking without commercial pricing data.
 */

import offlineCatalog from '../data/indianMedicinesCatalog.json' with { type: 'json' };
import { apiFetch, isOnline } from '../config/apiConfig.js';

/**
 * Strips sensitive commercial price fields from medicine records
 */
function sanitizeMedicineItem(item) {
  if (!item) return null;
  const { price, price_inr, ...clean } = item;
  return clean;
}

/**
 * Search the Indian medicine database with relevance-based ranking.
 * Returns only the top best matches (default 5) without price information.
 * 
 * @param {string} query Search term (brand name, generic ingredient, or manufacturer)
 * @param {number} limit Maximum results to return (default 5)
 * @returns {Promise<Array>} List of best matching medicines
 */
export async function searchIndianMedicines(query, limit = 5) {
  if (!query || typeof query !== 'string') return [];
  const clean = query.trim().toLowerCase();
  if (clean.length < 2) return [];

  // 1. Client-Side Offline In-Memory Search with Intelligent Relevance Scoring
  const scoredLocal = [];
  const seenLocalBrands = new Set();

  for (const rawItem of offlineCatalog) {
    const brand = (rawItem.brand || '').toLowerCase();
    const generic = (rawItem.generic || '').toLowerCase();
    const mfr = (rawItem.mfr || '').toLowerCase();

    let score = 0;
    if (brand === clean) {
      score += 1000; // Exact brand match
    } else if (brand.startsWith(clean + ' ')) {
      score += 700; // Exact word prefix
    } else if (brand.startsWith(clean)) {
      score += 500; // Brand prefix match
    } else if (new RegExp(`\\b${clean}`).test(brand)) {
      score += 300; // Word boundary match in brand
    } else if (generic.startsWith(clean)) {
      score += 200; // Generic ingredient prefix match
    } else if (brand.includes(clean)) {
      score += 100; // Brand substring match
    } else if (generic.includes(clean)) {
      score += 50; // Generic substring match
    } else if (mfr.includes(clean)) {
      score += 20; // Manufacturer substring match
    }

    if (score > 0) {
      // Shorter brand names are prioritized among similar scores for cleaner results
      score -= (rawItem.brand || '').length * 0.1;
      const brandKey = brand.trim();
      if (!seenLocalBrands.has(brandKey)) {
        seenLocalBrands.add(brandKey);
        scoredLocal.push({ item: sanitizeMedicineItem(rawItem), score });
      }
    }
  }

  scoredLocal.sort((a, b) => b.score - a.score);
  const localMatches = scoredLocal.slice(0, limit).map(s => s.item);

  // 2. If online and backend DB is available, query ranked results from the 253,000+ database
  if (isOnline()) {
    try {
      const res = await apiFetch(`/indian-medicines?search=${encodeURIComponent(clean)}&limit=${limit}`, {}, 3000);
      if (res && res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.medicines) && data.medicines.length > 0) {
          const sanitizedApi = data.medicines.map(sanitizeMedicineItem);
          // Prioritize high-quality server matches and fill with local matches if needed
          const seen = new Set(sanitizedApi.map(m => m.brand.toLowerCase()));
          const extra = localMatches.filter(m => !seen.has(m.brand.toLowerCase()));
          return [...sanitizedApi, ...extra].slice(0, limit);
        }
      }
    } catch (e) {
      // Backend request timed out or offline, fall back to localMatches
    }
  }

  return localMatches.slice(0, limit);
}

/**
 * Format medicine item for prefilling AddEditMedicinePage (no price)
 */
export function formatMedicineForPrefill(med) {
  if (!med) return null;
  return {
    name: med.brand,
    genericIngredient: med.generic || '',
    strength: med.strength || '',
    dosage: med.strength ? `1 ${med.form || 'Tablet'} (${med.strength})` : `1 ${med.form || 'Tablet'}`,
    form: med.form || 'Tablet',
    frequency: 'Once daily',
    instructions: med.class ? `Class: ${med.class}. Take as prescribed.` : 'Take as directed by doctor.',
    prescribedBy: med.mfr ? `Mfr: ${med.mfr}` : ''
  };
}
