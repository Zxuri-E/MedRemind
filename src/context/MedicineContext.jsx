import React, { createContext, useContext, useState, useEffect } from 'react';
import { format } from 'date-fns';
import { useAuth } from './AuthContext';
import { 
  scheduleMedicationDoseNotification, 
  cancelMedicationNotifications, 
  snoozeNotification 
} from '../services/notificationService';
import { alarmService } from '../services/alarmService';
import { 
  parseArbitraryTime,
  getMedicineStartDate,
  getMedicineCreatedTime,
  getMedicineTimings,
  getSlotNameForTime,
  isMedicineInSlot,
  isMedicineActiveOnDate
} from '../utils/scheduleSlotUtils.js';
import { toast } from 'sonner';

export {
  parseArbitraryTime,
  getMedicineStartDate,
  getMedicineCreatedTime,
  getMedicineTimings,
  getSlotNameForTime,
  isMedicineInSlot,
  isMedicineActiveOnDate
};

const MedicineContext = createContext(null);

export function MedicineProvider({ children }) {
  const auth = useAuth?.() || {};
  const currentUser = auth.currentUser || null;
  const currentUserId = currentUser?.id || null;
  const todayKey = format(new Date(), 'yyyy-MM-dd');

  // Medicines state: Real user records, starting clean without fabricated demo data, scoped strictly per user
  const [medicines, setMedicines] = useState(() => {
    if (!currentUserId) return [];
    try {
      const userKey = `medremind_medicines_${currentUserId}`;
      const saved = localStorage.getItem(userKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map(m => ({
            ...m,
            startDate: m.startDate || getMedicineStartDate(m),
            createdAt: m.createdAt || (m.startDate ? `${m.startDate}T00:00:00.000Z` : new Date().toISOString())
          }));
        }
      } else {
        const legacy = localStorage.getItem('medremind_medicines');
        if (legacy) {
          const parsed = JSON.parse(legacy);
          const owned = Array.isArray(parsed) ? parsed.filter(m => !m.userId || m.userId === currentUserId || m.userId === 'local_user') : [];
          if (owned.length > 0) {
            return owned.map(m => ({
              ...m,
              userId: currentUserId,
              startDate: m.startDate || getMedicineStartDate(m),
              createdAt: m.createdAt || (m.startDate ? `${m.startDate}T00:00:00.000Z` : new Date().toISOString())
            }));
          }
        }
      }
    } catch (e) { /* ignore */ }
    return [];
  });

  // Dose tracking logs: scoped per user
  const [doseLogs, setDoseLogs] = useState(() => {
    if (!currentUserId) return {};
    try {
      const saved = localStorage.getItem(`medremind_dose_logs_${currentUserId}`);
      if (saved) return JSON.parse(saved);
    } catch (e) { /* ignore */ }
    return {};
  });

  // Profile state: initialized clean without hardcoded placeholder identities
  const [patientProfile, setPatientProfile] = useState(() => {
    const defaultProfile = {
      bloodType: "Not specified",
      allergies: [],
      emergencyContact: null,
      settings: {
        soundEnabled: true,
        doseReminders: true,
        quietHoursStart: "23:00",
        quietHoursEnd: "07:00"
      }
    };
    if (!currentUserId) return defaultProfile;
    try {
      const saved = localStorage.getItem(`medremind_patient_profile_${currentUserId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.name && parsed.name !== 'Alex Morgan') {
          return parsed;
        }
      }
    } catch (e) { /* ignore */ }
    return {
      ...defaultProfile,
      name: currentUser?.name || '',
      email: currentUser?.email || ''
    };
  });

  // Notifications / Alerts state: Real system & medication alerts, starting clean
  const [notifications, setNotifications] = useState(() => {
    if (!currentUserId) return [];
    try {
      const saved = localStorage.getItem(`medremind_notifications_${currentUserId}`);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.filter(n => !['notif-1', 'notif-2'].includes(n.id));
        }
      }
    } catch (e) { /* ignore */ }
    return [];
  });

  // User Lifecycle Synchronization: When user switches or logs out, immediately swap data
  useEffect(() => {
    if (!currentUserId) {
      setMedicines([]);
      setDoseLogs({});
      setNotifications([]);
      setPatientProfile({
        bloodType: "Not specified",
        allergies: [],
        emergencyContact: null,
        settings: {
          soundEnabled: true,
          doseReminders: true,
          quietHoursStart: "23:00",
          quietHoursEnd: "07:00"
        }
      });
      return;
    }

    const userMedKey = `medremind_medicines_${currentUserId}`;
    const userLogsKey = `medremind_dose_logs_${currentUserId}`;
    const userProfileKey = `medremind_patient_profile_${currentUserId}`;
    const userNotifsKey = `medremind_notifications_${currentUserId}`;

    try {
      const savedMeds = localStorage.getItem(userMedKey);
      if (savedMeds) {
        const parsed = JSON.parse(savedMeds);
        setMedicines(Array.isArray(parsed) ? parsed : []);
      } else {
        const legacy = localStorage.getItem('medremind_medicines');
        if (legacy) {
          const parsed = JSON.parse(legacy);
          const owned = Array.isArray(parsed) ? parsed.filter(m => !m.userId || m.userId === currentUserId || m.userId === 'local_user') : [];
          if (owned.length > 0) {
            const mapped = owned.map(m => ({ ...m, userId: currentUserId }));
            setMedicines(mapped);
            localStorage.setItem(userMedKey, JSON.stringify(mapped));
          } else {
            setMedicines([]);
          }
        } else {
          setMedicines([]);
        }
      }
    } catch {
      setMedicines([]);
    }

    try {
      const savedLogs = localStorage.getItem(userLogsKey);
      setDoseLogs(savedLogs ? JSON.parse(savedLogs) : {});
    } catch {
      setDoseLogs({});
    }

    try {
      const savedNotifs = localStorage.getItem(userNotifsKey);
      setNotifications(savedNotifs ? JSON.parse(savedNotifs) : []);
    } catch {
      setNotifications([]);
    }

    try {
      const savedProfile = localStorage.getItem(userProfileKey);
      if (savedProfile) {
        setPatientProfile(JSON.parse(savedProfile));
      } else {
        setPatientProfile({
          name: currentUser?.name || '',
          email: currentUser?.email || '',
          phoneNumber: currentUser?.phoneNumber || currentUser?.phone || '',
          bloodType: "Not specified",
          allergies: [],
          emergencyContact: null,
          settings: {
            soundEnabled: true,
            doseReminders: true,
            quietHoursStart: "23:00",
            quietHoursEnd: "07:00"
          }
        });
      }
    } catch {
      setPatientProfile({
        name: currentUser?.name || '',
        email: currentUser?.email || ''
      });
    }
  }, [currentUserId]);

  // Persist state updates to user-scoped storage
  useEffect(() => {
    if (currentUserId) {
      localStorage.setItem(`medremind_medicines_${currentUserId}`, JSON.stringify(medicines));
      localStorage.setItem('medremind_medicines', JSON.stringify(medicines));
    }
  }, [medicines, currentUserId]);

  useEffect(() => {
    if (currentUserId) {
      localStorage.setItem(`medremind_dose_logs_${currentUserId}`, JSON.stringify(doseLogs));
      localStorage.setItem('medremind_dose_logs', JSON.stringify(doseLogs));
    }
  }, [doseLogs, currentUserId]);

  useEffect(() => {
    if (currentUserId) {
      localStorage.setItem(`medremind_patient_profile_${currentUserId}`, JSON.stringify(patientProfile));
      localStorage.setItem('medremind_patient_profile', JSON.stringify(patientProfile));
    }
  }, [patientProfile, currentUserId]);

  useEffect(() => {
    if (currentUserId) {
      localStorage.setItem(`medremind_notifications_${currentUserId}`, JSON.stringify(notifications));
      localStorage.setItem('medremind_notifications', JSON.stringify(notifications));
    }
  }, [notifications, currentUserId]);

  // Dose Tracking Actions with Date Flexibility & Future Dose Safeguard
  const recordDose = (medId, timeSlot, status, scheduledTime = null, targetDateStr = null) => {
    const dateKey = targetDateStr || todayKey;
    const isToday = dateKey === todayKey;
    const isFuture = dateKey > todayKey;

    if (isFuture) {
      toast.error('Dose cannot be recorded for future days.');
      return false;
    }

    // Strictly block recording future doses for today
    const now = new Date();
    const timeStr = scheduledTime || timeSlot;
    if (isToday && timeStr) {
      const { hours, minutes } = parseArbitraryTime(timeStr);
      const scheduledDateTime = new Date();
      scheduledDateTime.setHours(hours, minutes, 0, 0);

      // Grace margin of 60 seconds
      if (scheduledDateTime.getTime() - now.getTime() > 60000) {
        toast.error('Dose cannot be recorded before its scheduled time.');
        return false;
      }
    }

    const timestamp = format(new Date(), 'hh:mm a');
    setDoseLogs(prev => {
      const dayLogs = prev[dateKey] || {};
      const updatedDayLogs = {
        ...dayLogs,
        [`${medId}_${timeSlot}`]: { status, timestamp }
      };

      // Also mirror the dose record to all timing aliases of this medication
      const med = medicines.find(m => m.id === medId);
      if (med) {
        const timings = getMedicineTimings(med);
        timings.forEach(t => {
          updatedDayLogs[`${medId}_${t}`] = { status, timestamp };
        });
        const slotName = getSlotNameForTime(timeSlot);
        if (slotName) {
          updatedDayLogs[`${medId}_${slotName}`] = { status, timestamp };
        }
      }

      return {
        ...prev,
        [dateKey]: updatedDayLogs
      };
    });

    // If dose skipped, record notification
    if (status === 'skipped') {
      const med = medicines.find(m => m.id === medId);
      addNotification({
        title: `Dose Skipped: ${med ? med.name : 'Medication'}`,
        message: `${patientProfile.name || 'Patient'} recorded the ${timeSlot} dose as skipped.`,
        type: "warning"
      });
    }
    return true;
  };

  const resetDose = (medId, timeSlot, targetDateStr = null) => {
    const dateKey = targetDateStr || todayKey;
    setDoseLogs(prev => {
      const dayLogs = { ...(prev[dateKey] || {}) };
      delete dayLogs[`${medId}_${timeSlot}`];

      // Clean up mirror keys for this medication
      const med = medicines.find(m => m.id === medId);
      if (med) {
        const timings = getMedicineTimings(med);
        timings.forEach(t => {
          delete dayLogs[`${medId}_${t}`];
        });
        const slotName = getSlotNameForTime(timeSlot);
        if (slotName) {
          delete dayLogs[`${medId}_${slotName}`];
        }
      }

      return {
        ...prev,
        [dateKey]: dayLogs
      };
    });
  };

  const getDoseStatus = (medId, timeSlot, dateStr = todayKey) => {
    const day = doseLogs[dateStr];
    if (!day) return null;
    if (day[`${medId}_${timeSlot}`]) return day[`${medId}_${timeSlot}`];

    // Fallback: check all timing aliases for this medication
    const med = medicines.find(m => m.id === medId);
    if (med) {
      const timings = getMedicineTimings(med);
      for (const t of timings) {
        if (day[`${medId}_${t}`]) return day[`${medId}_${t}`];
      }
      const slotName = getSlotNameForTime(timeSlot);
      if (slotName && day[`${medId}_${slotName}`]) {
        return day[`${medId}_${slotName}`];
      }
    }
    return null;
  };

  // Medicine Management (Active/Inactive Toggle & History Preservation)
  const toggleMedicineActive = (id) => {
    setMedicines(prev => prev.map(m => {
      if (m.id === id) {
        const nextStatus = m.status === 'Inactive' ? 'Active' : 'Inactive';
        if (nextStatus === 'Inactive') {
          alarmService.setMedicineActive(m.id, false);
          cancelMedicationNotifications(m.id);
          addNotification({
            title: `Medication Inactive: ${m.name}`,
            message: `${m.name} has been paused. Pending alarms have been cancelled. History is preserved.`,
            type: "info"
          });
        } else {
          // Reactivate alarms for all time slots
          alarmService.setMedicineActive(m.id, true);
          const slots = m.times && m.times.length > 0 ? m.times : (m.timeSlots || ['08:00 AM']);
          slots.forEach(t => scheduleMedicationDoseNotification({ ...m, status: 'Active' }, t, m.id));
          addNotification({
            title: `Medication Reactivated: ${m.name}`,
            message: `${m.name} is active. Daily reminders have been rescheduled.`,
            type: "info"
          });
        }
        return { ...m, status: nextStatus };
      }
      return m;
    }));
  };

  const snoozeReminder = async (medId, timeSlot, minutes = 10) => {
    const med = medicines.find(m => m.id === medId);
    if (!med || med.status === 'Inactive') return;
    await snoozeNotification(med, timeSlot, minutes);
    toast.info(`Reminder for ${med.name} snoozed for ${minutes} minutes.`);
  };

  const updatePatientProfile = (updates) => {
    setPatientProfile(prev => {
      const updated = { ...prev, ...updates };
      try {
        localStorage.setItem('medremind_patient_profile', JSON.stringify(updated));
      } catch (e) {
        console.warn('LocalStorage save failed:', e);
      }
      return updated;
    });
  };

  const addMedicine = (medData) => {
    const now = new Date();
    const newMed = {
      ...medData,
      id: `med-${Date.now()}`,
      userId: currentUserId || 'local_user',
      status: "Active",
      createdAt: medData.createdAt || now.toISOString(),
      startDate: medData.startDate || format(now, 'yyyy-MM-dd')
    };
    setMedicines(prev => [newMed, ...prev]);
    addNotification({
      title: "New Medicine Added",
      message: `${newMed.name} ${newMed.dosage || ''} is now active on your schedule.`,
      type: "info"
    });
    // Schedule native reminders for arbitrary time slots
    const slots = newMed.times && newMed.times.length > 0 ? newMed.times : (newMed.timeSlots || ['08:00 AM']);
    slots.forEach(t => scheduleMedicationDoseNotification(newMed, t, newMed.id));
    return newMed;
  };

  const updateMedicine = (id, updatedData) => {
    setMedicines(prev => prev.map(m => {
      if (m.id === id) {
        const updated = { ...m, ...updatedData };
        if (updated.status === 'Inactive') {
          alarmService.setMedicineActive(m.id, false);
          cancelMedicationNotifications(m.id);
        } else if (updated.status === 'Active') {
          alarmService.setMedicineActive(m.id, true);
          cancelMedicationNotifications(m.id);
          const slots = updated.times && updated.times.length > 0 ? updated.times : (updated.timeSlots || ['08:00 AM']);
          slots.forEach(t => scheduleMedicationDoseNotification(updated, t, updated.id));
        }
        return updated;
      }
      return m;
    }));
  };

  const deleteMedicine = (id) => {
    alarmService.setMedicineActive(id, false);
    cancelMedicationNotifications(id);
    setMedicines(prev => prev.filter(m => m.id !== id));
  };

  // Prescription Approval Action with Intelligent Duplicate Prevention
  const approvePrescription = (extracted) => {
    const brand = (extracted.brandName || extracted.medicineName || '').trim();
    const generic = (extracted.genericIngredient || extracted.medicineName || '').trim();
    const strength = (extracted.strength || extracted.dosage || '').toLowerCase().replace(/\s+/g, '');

    // Check if duplicate of an existing active medicine in local state
    const existingIdx = medicines.findIndex(m => {
      const mBrand = (m.brandName || m.name || '').toLowerCase().trim();
      const mGeneric = (m.genericIngredient || m.name || '').toLowerCase().trim();
      const mStrength = (m.strength || m.dosage || '').toLowerCase().replace(/\s+/g, '');

      const isSameMed = (
        brand.toLowerCase() === mBrand ||
        brand.toLowerCase() === mGeneric ||
        generic.toLowerCase() === mBrand ||
        generic.toLowerCase() === mGeneric
      );

      return isSameMed && (!strength || !mStrength || strength === mStrength || mStrength.includes(strength));
    });

    if (existingIdx !== -1) {
      // Update existing routine instead of creating redundant duplicate!
      const existingMed = medicines[existingIdx];
      const updatedMed = {
        ...existingMed,
        instructions: extracted.instructions || existingMed.instructions,
        frequency: extracted.frequency || existingMed.frequency,
        timeSlots: extracted.timeSlots && extracted.timeSlots.length > 0 ? extracted.timeSlots : existingMed.timeSlots,
        times: extracted.times && extracted.times.length > 0 ? extracted.times : existingMed.times,
        morningDose: extracted.morningDose !== undefined ? extracted.morningDose : existingMed.morningDose,
        afternoonDose: extracted.afternoonDose !== undefined ? extracted.afternoonDose : existingMed.afternoonDose,
        nightDose: extracted.nightDose !== undefined ? extracted.nightDose : existingMed.nightDose,
        lastUpdated: format(new Date(), 'yyyy-MM-dd HH:mm')
      };

      setMedicines(prev => prev.map((m, i) => i === existingIdx ? updatedMed : m));
      addNotification({
        title: "Medication Routine Updated",
        message: `Existing routine for ${updatedMed.name} was updated without creating a duplicate.`,
        type: "info"
      });

      // Reschedule reminders
      if (updatedMed.times && Array.isArray(updatedMed.times)) {
        updatedMed.times.forEach(t => scheduleMedicationDoseNotification(updatedMed, t, updatedMed.id));
      }
      return updatedMed;
    }

    // New medication
    const approvedMed = {
      id: `med-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      userId: currentUserId || 'local_user',
      name: brand,
      brandName: brand,
      genericIngredient: generic,
      dosage: extracted.dosage || '1 Tablet',
      strength: extracted.strength || 'As Prescribed',
      form: extracted.form || "Tablet",
      frequency: extracted.frequency,
      morningDose: extracted.morningDose,
      afternoonDose: extracted.afternoonDose,
      nightDose: extracted.nightDose,
      timeSlots: extracted.timeSlots && extracted.timeSlots.length > 0 ? extracted.timeSlots : ["Morning (8:00 AM)"],
      times: extracted.times && extracted.times.length > 0 ? extracted.times : ["08:00"],
      status: "Active",
      instructions: extracted.instructions || "Take as directed by doctor.",
      prescribedBy: extracted.doctor || "Verified from Prescription Scan",
      createdAt: new Date().toISOString(),
      startDate: format(new Date(), 'yyyy-MM-dd'),
      duration: extracted.duration || "7 days",
      refillsRemaining: extracted.refills || 0,
      pillCount: 30,
      color: "#238B78"
    };

    setMedicines(prev => [approvedMed, ...prev]);
    addNotification({
      title: "Prescription Approved & Scheduled",
      message: `${approvedMed.name} (${approvedMed.genericIngredient}) has been verified and added to your daily schedule.`,
      type: "success"
    });
    // Schedule native reminders for approved prescription
    if (approvedMed.times && Array.isArray(approvedMed.times)) {
      approvedMed.times.forEach(t => scheduleMedicationDoseNotification(approvedMed, t, approvedMed.id));
    }
    return approvedMed;
  };

  const addNotification = (notif) => {
    const newNotif = {
      id: `notif-${Date.now()}`,
      time: format(new Date(), 'hh:mm a'),
      read: false,
      ...notif
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  const markNotificationRead = (id) => {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  // Metrics computation for dashboard
  const getTodayMetrics = () => {
    let totalDoses = 0;
    let takenDoses = 0;
    let skippedDoses = 0;

    medicines.filter(m => m.status === 'Active').forEach(med => {
      if (!isMedicineActiveOnDate(med, todayKey)) return;

      const timings = getMedicineTimings(med);
      timings.forEach(slot => {
        totalDoses += 1;
        const status = getDoseStatus(med.id, slot);
        if (status?.status === 'taken') takenDoses += 1;
        if (status?.status === 'skipped') skippedDoses += 1;
      });
    });

    const pendingDoses = Math.max(0, totalDoses - takenDoses - skippedDoses);
    // When no doses are scheduled today, adherence is null (never fake 100%)
    const adherencePercent = totalDoses > 0 ? Math.round((takenDoses / totalDoses) * 100) : null;

    return {
      totalDoses,
      takenDoses,
      skippedDoses,
      pendingDoses,
      adherencePercent
    };
  };

  /**
   * ITEM 8 Helper: getWeeklyCompliance(weekStartDate)
   * Calculates per-day compliance for a 7-day period starting on weekStartDate.
   * Categorizes scheduled doses into:
   * - taken: dose recorded as 'taken'
   * - skipped: dose recorded as 'skipped'
   * - missed: dose whose scheduled time has passed with no status (not future, and within active routine)
   */
  const getWeeklyCompliance = (weekStartDate) => {
    const startDate = weekStartDate instanceof Date ? weekStartDate : new Date(weekStartDate);
    const days = [];
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');

    let weekTaken = 0;
    let weekSkipped = 0;
    let weekMissed = 0;
    let weekScheduled = 0;

    for (let i = 0; i < 7; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);
      const dateStr = format(d, 'yyyy-MM-dd');
      const isFutureDay = dateStr > todayStr;
      const isToday = dateStr === todayStr;

      let dayTotal = 0;
      let dayTaken = 0;
      let daySkipped = 0;
      let dayMissed = 0;

      medicines.filter(m => m.status === 'Active').forEach(med => {
        // STRICT: Only count doses on days where the routine was active
        if (!isMedicineActiveOnDate(med, dateStr)) {
          return;
        }

        const medCreatedTime = getMedicineCreatedTime(med);
        const timings = getMedicineTimings(med);

        timings.forEach(slot => {
          const status = getDoseStatus(med.id, slot, dateStr);

          if (status?.status === 'taken') {
            dayTotal += 1;
            dayTaken += 1;
          } else if (status?.status === 'skipped') {
            dayTotal += 1;
            daySkipped += 1;
          } else if (!isFutureDay) {
            // Day is today or in the past (within active medication schedule)
            if (isToday) {
              const { hours, minutes } = parseArbitraryTime(slot);
              const schedTime = new Date();
              schedTime.setHours(hours, minutes, 0, 0);

              // Dose was scheduled after the medicine was added to the app
              const wasCreatedBeforeSlot = !medCreatedTime || (schedTime.getTime() >= medCreatedTime - 60000);

              if (now.getTime() >= schedTime.getTime()) {
                if (wasCreatedBeforeSlot) {
                  dayTotal += 1;
                  dayMissed += 1;
                }
              } else {
                // Pending future dose later today
                dayTotal += 1;
              }
            } else {
              // Past day within medication active duration with no taken/skipped record: marked missed
              dayTotal += 1;
              dayMissed += 1;
            }
          } else {
            // Future day within medication active duration
            dayTotal += 1;
          }
        });
      });

      const dayEvaluated = dayTaken + daySkipped + dayMissed;
      const dayAdherence = dayEvaluated > 0
        ? Math.round((dayTaken / dayEvaluated) * 100)
        : null;

      days.push({
        date: dateStr,
        dayLabel: format(d, 'EEE'),
        dayNumber: format(d, 'd'),
        total: dayTotal,
        taken: dayTaken,
        skipped: daySkipped,
        missed: dayMissed,
        adherencePercent: dayAdherence
      });

      weekTaken += dayTaken;
      weekSkipped += daySkipped;
      weekMissed += dayMissed;
      weekScheduled += dayEvaluated;
    }

    const overallAdherence = weekScheduled > 0
      ? Math.round((weekTaken / weekScheduled) * 100)
      : null;

    return {
      days,
      weekTaken,
      weekSkipped,
      weekMissed,
      weekScheduled,
      overallAdherence
    };
  };

  return (
    <MedicineContext.Provider value={{
      medicines,
      doseLogs,
      patientProfile,
      updatePatientProfile,
      notifications,
      recordDose,
      resetDose,
      getDoseStatus,
      addMedicine,
      updateMedicine,
      deleteMedicine,
      toggleMedicineActive,
      snoozeReminder,
      approvePrescription,
      addNotification,
      markNotificationRead,
      getTodayMetrics,
      getWeeklyCompliance,
      getMedicineStartDate,
      getMedicineCreatedTime,
      getMedicineTimings,
      getSlotNameForTime,
      isMedicineInSlot,
      isMedicineActiveOnDate
    }}>
      {children}
    </MedicineContext.Provider>
  );
}

export function useMedicine() {
  const context = useContext(MedicineContext);
  if (!context) {
    throw new Error('useMedicine must be used within a MedicineProvider');
  }
  return context;
}
