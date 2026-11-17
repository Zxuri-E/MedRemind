import { format } from 'date-fns';

/**
 * Parses any arbitrary time string into { hours, minutes }
 * Handles: "08:00 AM", "8:00 AM", "08:00", "1:00 PM", "13:00", "Morning (8:00 AM)", etc.
 */
export function parseArbitraryTime(timeStr) {
  if (!timeStr) return { hours: 8, minutes: 0 };
  const clean = String(timeStr).trim();

  // Pattern: 1-2 digits : 2 digits optional AM/PM
  const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return { 
      hours: Math.min(23, Math.max(0, hours)), 
      minutes: Math.min(59, Math.max(0, minutes)) 
    };
  }

  // Fallbacks for named periods
  const lower = clean.toLowerCase();
  if (lower.includes('morning')) return { hours: 8, minutes: 0 };
  if (lower.includes('afternoon') || lower.includes('lunch')) return { hours: 13, minutes: 0 };
  if (lower.includes('evening')) return { hours: 19, minutes: 0 };
  if (lower.includes('night') || lower.includes('bedtime')) return { hours: 22, minutes: 0 };

  return { hours: 8, minutes: 0 };
}

/**
 * Safely extracts the start date (yyyy-MM-dd) of a medication routine.
 */
export function getMedicineStartDate(med) {
  if (!med) return format(new Date(), 'yyyy-MM-dd');
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  if (med.startDate && typeof med.startDate === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(med.startDate)) {
      return med.startDate.split('T')[0];
    }
    const dmyMatch = med.startDate.trim().match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      const year = dmyMatch[3];
      return `${year}-${month}-${day}`;
    }
    try {
      const parsed = new Date(med.startDate);
      if (!isNaN(parsed.getTime())) {
        return format(parsed, 'yyyy-MM-dd');
      }
    } catch (e) {}
  }
  if (med.createdAt && typeof med.createdAt === 'string') {
    try {
      const d = new Date(med.createdAt);
      if (!isNaN(d.getTime())) return format(d, 'yyyy-MM-dd');
    } catch (e) {}
  }
  if (med.id && typeof med.id === 'string') {
    const match = med.id.match(/^med-(\d{10,})/);
    if (match) {
      try {
        const ts = parseInt(match[1], 10);
        if (!isNaN(ts) && ts > 1000000000000) {
          return format(new Date(ts), 'yyyy-MM-dd');
        }
      } catch (e) {}
    }
  }
  return todayStr;
}

/**
 * Helper to retrieve epoch millisecond creation timestamp of a medication.
 */
export function getMedicineCreatedTime(med) {
  if (!med) return 0;
  if (med.createdAt) {
    const t = new Date(med.createdAt).getTime();
    if (!isNaN(t)) return t;
  }
  if (med.id && typeof med.id === 'string') {
    const match = med.id.match(/^med-(\d{10,})/);
    if (match) {
      const ts = parseInt(match[1], 10);
      if (!isNaN(ts) && ts > 1000000000000) {
        return ts;
      }
    }
  }
  if (med.startDate) {
    const d = new Date(med.startDate);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  return 0;
}

/**
 * Normalizes all scheduled dose times from a medication object into an array of strings.
 * Gathers timings from timeSlots, times, timeSlot, time, or explicit morning/afternoon/night dose flags.
 */
export function getMedicineTimings(med) {
  if (!med) return ['Morning (8:00 AM)'];
  const rawList = [];

  if (Array.isArray(med.timeSlots) && med.timeSlots.length > 0) {
    rawList.push(...med.timeSlots);
  }
  if (Array.isArray(med.times) && med.times.length > 0) {
    rawList.push(...med.times);
  }
  if (med.timeSlot && typeof med.timeSlot === 'string') {
    rawList.push(med.timeSlot);
  }
  if (med.time && typeof med.time === 'string') {
    rawList.push(med.time);
  }

  // Include explicit dosage flags if not already represented
  if (med.morningDose && med.morningDose > 0 && !rawList.some(t => String(t).toLowerCase().includes('morn'))) {
    rawList.push('Morning (8:00 AM)');
  }
  if (med.afternoonDose && med.afternoonDose > 0 && !rawList.some(t => String(t).toLowerCase().includes('after') || String(t).toLowerCase().includes('noon'))) {
    rawList.push('Afternoon (1:00 PM)');
  }
  if (med.eveningDose && med.eveningDose > 0 && !rawList.some(t => String(t).toLowerCase().includes('eve'))) {
    rawList.push('Evening (7:00 PM)');
  }
  if (med.nightDose && med.nightDose > 0 && !rawList.some(t => String(t).toLowerCase().includes('night') || String(t).toLowerCase().includes('bed'))) {
    rawList.push('Night (10:00 PM)');
  }

  const unique = Array.from(new Set(rawList.filter(Boolean)));
  return unique.length > 0 ? unique : ['Morning (8:00 AM)'];
}

/**
 * Maps any arbitrary time string (e.g. "08:00 AM", "08:00", "13:00", "7:30 PM", "Night")
 * to one of the 4 standard schedule slots: Morning, Afternoon, Evening, Night.
 */
export function getSlotNameForTime(timeStr) {
  if (!timeStr) return 'Morning';
  const s = String(timeStr).toLowerCase();

  // Word-based fast checks
  if (s.includes('morn') || s.includes('breakfast')) return 'Morning';
  if (s.includes('afternoon') || s.includes('noon') || s.includes('midday') || s.includes('lunch')) return 'Afternoon';
  if (s.includes('eve') || s.includes('dinner') || s.includes('supper')) return 'Evening';
  if (s.includes('night') || s.includes('bed') || s.includes('hs')) return 'Night';

  // Numeric hour-based categorization
  const { hours } = parseArbitraryTime(timeStr);
  if (hours >= 4 && hours < 12) return 'Morning';
  if (hours >= 12 && hours < 17) return 'Afternoon';
  if (hours >= 17 && hours < 21) return 'Evening';
  return 'Night';
}

/**
 * Checks whether a given medication is scheduled during a specific slot name.
 */
export function isMedicineInSlot(med, slotName) {
  if (!med) return false;
  const targetSlot = String(slotName).toLowerCase();

  // Direct flag matching for OCR / prescriptions
  if (targetSlot === 'morning' && (med.morningDose > 0 || med.morning)) return true;
  if (targetSlot === 'afternoon' && (med.afternoonDose > 0 || med.afternoon)) return true;
  if (targetSlot === 'evening' && (med.eveningDose > 0 || med.evening)) return true;
  if (targetSlot === 'night' && (med.nightDose > 0 || med.night)) return true;

  const timings = getMedicineTimings(med);
  const matches = timings.some(timing => {
    const slotForTiming = getSlotNameForTime(timing);
    return slotForTiming && slotForTiming.toLowerCase() === targetSlot;
  });
  if (matches) return true;

  // Fallback: If medicine has no specific time and this is Morning, put it in Morning so it's never lost!
  if (targetSlot === 'morning' && timings.length === 0 && !med.morningDose && !med.afternoonDose && !med.eveningDose && !med.nightDose) {
    return true;
  }
  return false;
}

/**
 * Checks if a medication routine is active on a specific calendar date (yyyy-MM-dd).
 * Prevents phantom past doses before routine started, and ensures current/future active meds display properly.
 */
export function isMedicineActiveOnDate(med, dateStr) {
  if (!med) return false;
  if (med.status && String(med.status).toLowerCase() === 'inactive') return false;
  if (med.endDate && dateStr > med.endDate) return false;

  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const startDate = getMedicineStartDate(med);

  if (dateStr < todayStr) {
    // Past historical dates: only active if date is on or after medicine start date
    return dateStr >= startDate;
  }

  // Today and future dates: show active medicine unless explicitly scheduled to start in future
  if (startDate > todayStr && dateStr < startDate) {
    return false;
  }
  return true;
}
