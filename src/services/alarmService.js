/**
 * MedRemind Cross-Platform Alarm Engine
 * 
 * Guarantees:
 * 1. Exact 60-second alarm playback (continuous audio loop + auto-stop at 60s).
 * 2. Alarm survives user logout, token removal, React unmount, and page navigation.
 * 3. Immediate stop on user Dismiss/Stop.
 * 4. Separate Snooze that stops ringing and reschedules for +10 minutes.
 * 5. Idempotent triggers: never plays multiple overlapping alarms for the same reminder.
 * 6. Delegates to Android native AlarmManager & MedAlarmService when running in Capacitor.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { parseArbitraryTime } from './notificationService.js';

// Register native plugin if available
const MedAlarm = registerPlugin('MedAlarm');

const STORAGE_KEY_ACTIVE = 'medremind_active_alarm_state';
const STORAGE_KEY_SCHEDULED = 'medremind_scheduled_alarms';
const STORAGE_KEY_HISTORY = 'medremind_alarm_history';
const STORAGE_KEY_INACTIVE = 'medremind_inactive_medicines';
const STORAGE_KEY_DISMISSED_TODAY = 'medremind_dismissed_today';

const EXACT_ALARM_DURATION_MS = 60000; // Exactly 60 seconds

class AlarmService {
  constructor() {
    this.audio = null;
    this.autoStopTimer = null;
    this.countdownTimer = null;
    this.listeners = new Set();
    this.currentAlarm = null;
    this.webTickInterval = null;

    this.init();
  }

  init() {
    // 1. Recover active alarm or sync with native Android state
    if (Capacitor.isNativePlatform()) {
      this.syncWithNativeActiveState();
      // Listen to app foreground, resume, and visibility changes so stopped alarms do not replay
      try {
        import('@capacitor/app').then(({ App }) => {
          App.addListener('appStateChange', (state) => {
            if (state.isActive) {
              this.syncWithNativeActiveState();
            }
          });
          App.addListener('resume', () => {
            this.syncWithNativeActiveState();
          });
        }).catch(() => {});
      } catch (e) {}

      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') {
            this.syncWithNativeActiveState();
          }
        });
      }
    } else {
      try {
        const savedActive = localStorage.getItem(STORAGE_KEY_ACTIVE);
        if (savedActive) {
          const parsed = JSON.parse(savedActive);
          const now = Date.now();
          if (parsed.status === 'RINGING' && parsed.expireTime > now) {
            console.log('[AlarmService] Resuming active alarm after page load/navigation:', parsed.medicineName);
            this.resumeActiveAlarm(parsed);
          } else {
            // Expired while offline/closed
            this.clearActiveAlarmState('EXPIRED');
          }
        }
      } catch (e) {
        console.warn('[AlarmService] Error restoring active alarm state:', e);
      }
      this.startWebTicker();
    }
  }

  async syncWithNativeActiveState() {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const res = await MedAlarm.getActiveAlarm();
      if (!res || !res.hasActiveAlarm) {
        // Native reports NO active alarm (was stopped from notification or expired)
        if (this.currentAlarm || localStorage.getItem(STORAGE_KEY_ACTIVE)) {
          console.log('[AlarmService] Native alarm is inactive/dismissed. Clearing web state.');
          this.stopAudio();
          if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
          if (this.countdownTimer) clearInterval(this.countdownTimer);
          this.clearActiveAlarmState('DISMISSED_EXTERNALLY');
          this.notifyListeners();
        }
      } else {
        // Native has active alarm ringing
        const now = Date.now();
        const remainingSeconds = res.remainingSeconds || Math.max(0, Math.ceil((res.expirationTimestamp - now) / 1000));
        if (remainingSeconds > 0) {
          const record = {
            alarmId: res.alarmId,
            medicineId: res.medicineId,
            medicineName: res.medicineName,
            dosage: res.dosage,
            timeSlot: res.timeStr,
            startTime: res.triggerTimestamp,
            expireTime: res.expirationTimestamp,
            status: 'RINGING',
            dismissed: false
          };
          this.currentAlarm = record;
          this.persistActiveAlarm(record);
          this.startCountdownAndAutoStop(remainingSeconds * 1000);
          this.notifyListeners();
        }
      }
    } catch (e) {
      console.warn('[AlarmService] Error querying native active alarm:', e);
    }
  }

  // --- Observer Pattern for UI Subscription ---

  subscribe(callback) {
    this.listeners.add(callback);
    // Send immediate current state
    callback(this.getState());
    return () => this.listeners.delete(callback);
  }

  notifyListeners() {
    const state = this.getState();
    this.listeners.forEach(cb => {
      try { cb(state); } catch (e) { console.error('[AlarmService] Listener error:', e); }
    });
  }

  getState() {
    const now = Date.now();
    const isRinging = !!(this.currentAlarm && this.currentAlarm.status === 'RINGING' && this.currentAlarm.expireTime > now);
    const remainingSeconds = isRinging ? Math.max(0, Math.ceil((this.currentAlarm.expireTime - now) / 1000)) : 0;

    return {
      isRinging,
      activeAlarm: isRinging ? this.currentAlarm : null,
      remainingSeconds
    };
  }

  // --- Alarm Trigger & Playback (Strict 60 Seconds) ---

  async triggerAlarm(alarmData) {
    const { alarmId, medicineId, medicineName, dosage, timeSlot } = alarmData;
    const stableId = alarmId || `alarm_${medicineId || 'med'}_${Date.now()}`;

    // DO NOT RING IF MEDICINE IS INACTIVE
    if (medicineId && this.isMedicineInactive(medicineId)) {
      console.warn(`[AlarmService] Trigger rejected: medicine ${medicineId} is inactive.`);
      return;
    }

    // DO NOT RING IF ALREADY DISMISSED TODAY
    const todayKey = new Date().toISOString().split('T')[0];
    if (this.isDismissedToday(stableId, todayKey)) {
      console.log(`[AlarmService] Alarm ${stableId} was already dismissed today (${todayKey}). Ignoring trigger.`);
      return;
    }

    // IDEMPOTENCY: Check if triggered within last 60 seconds
    if (this.isDuplicateTrigger(stableId, 60000)) {
      console.warn(`[AlarmService] Duplicate trigger blocked for alarm ${stableId}`);
      return;
    }

    // If another alarm is already ringing, stop previous before starting new
    if (this.currentAlarm && this.currentAlarm.status === 'RINGING') {
      this.stopActiveAlarm('SUPERSEDED');
    }

    const now = Date.now();
    const expireTime = now + EXACT_ALARM_DURATION_MS;

    const alarmRecord = {
      alarmId: stableId,
      medicineId: medicineId || null,
      medicineName: medicineName || 'Medication Reminder',
      dosage: dosage || '1 dose',
      timeSlot: timeSlot || '',
      startTime: now,
      expireTime,
      status: 'RINGING',
      dismissed: false
    };

    this.currentAlarm = alarmRecord;
    this.persistActiveAlarm(alarmRecord);
    this.recordHistory(stableId, now, 'TRIGGERED');

    // Start Audio Playback (HTML5 Audio for web browser/fallback; native Android uses MediaPlayer in Service)
    this.startAudioLoop();

    // Start countdown and strict 60s auto-stop timer
    this.startCountdownAndAutoStop(expireTime - now);

    this.notifyListeners();
    console.log(`[AlarmService] Alarm ringing for ${alarmRecord.medicineName}. Strict 60s auto-stop scheduled.`);
  }

  resumeActiveAlarm(alarmRecord) {
    this.currentAlarm = alarmRecord;
    const remainingMs = alarmRecord.expireTime - Date.now();

    if (remainingMs > 0) {
      this.startAudioLoop();
      this.startCountdownAndAutoStop(remainingMs);
      this.notifyListeners();
    } else {
      this.clearActiveAlarmState('EXPIRED');
    }
  }

  startAudioLoop() {
    // On native Android (Capacitor), MedAlarmService is ALREADY looping MediaPlayer with alarm_chime.wav.
    // Playing HTML5 Audio in WebView causes dual sound, echo, and continues ringing after native stops!
    if (Capacitor.isNativePlatform()) {
      return;
    }

    try {
      if (!this.audio) {
        this.audio = new Audio('/alarm_chime.wav');
        this.audio.loop = true;
        this.audio.volume = 1.0;
      }
      this.audio.currentTime = 0;
      const playPromise = this.audio.play();
      if (playPromise !== undefined) {
        playPromise.catch(e => {
          console.warn('[AlarmService] Audio autoplay blocked or interrupted:', e.message);
        });
      }
    } catch (e) {
      console.warn('[AlarmService] Could not play audio chime:', e);
    }
  }

  stopAudio() {
    if (this.audio) {
      try {
        this.audio.pause();
        this.audio.currentTime = 0;
      } catch (e) {}
    }
  }

  startCountdownAndAutoStop(durationMs) {
    if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);

    // Countdown notification every second for smooth UI progress
    this.countdownTimer = setInterval(() => {
      if (!this.currentAlarm || this.currentAlarm.status !== 'RINGING') {
        clearInterval(this.countdownTimer);
        return;
      }
      if (Date.now() >= this.currentAlarm.expireTime) {
        clearInterval(this.countdownTimer);
        this.handleAutoStop();
      } else {
        this.notifyListeners();
      }
    }, 1000);

    // EXACT 60-SECOND AUTO-STOP
    this.autoStopTimer = setTimeout(() => {
      this.handleAutoStop();
    }, Math.max(100, durationMs));
  }

  handleAutoStop() {
    console.log('[AlarmService] 60 seconds reached. Automatically stopping alarm.');
    this.stopAudio();
    if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);

    if (this.currentAlarm) {
      const todayKey = new Date().toISOString().split('T')[0];
      this.recordDismissedToday(this.currentAlarm.alarmId, todayKey);
      this.recordHistory(this.currentAlarm.alarmId, Date.now(), 'EXPIRED');
    }

    this.clearActiveAlarmState('EXPIRED');
    this.notifyListeners();
  }

  // --- Explicit User Actions (Stop & Snooze) ---

  async stopActiveAlarm(reason = 'DISMISSED') {
    console.log('[AlarmService] Stopping active alarm. Reason:', reason);
    this.stopAudio();
    if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
    if (this.countdownTimer) clearInterval(this.countdownTimer);

    if (this.currentAlarm) {
      const todayKey = new Date().toISOString().split('T')[0];
      this.recordDismissedToday(this.currentAlarm.alarmId, todayKey);
      this.recordHistory(this.currentAlarm.alarmId, Date.now(), reason);
    }

    // Call native Android plugin to stop foreground service & media player
    if (Capacitor.isNativePlatform()) {
      try {
        await MedAlarm.stopActiveAlarm();
      } catch (e) {
        console.warn('[AlarmService] Native stop error:', e);
      }
    }

    this.clearActiveAlarmState(reason);
    this.notifyListeners();
  }

  async snoozeActiveAlarm(minutes = 10) {
    if (!this.currentAlarm) return;

    const medId = this.currentAlarm.medicineId;
    const medName = this.currentAlarm.medicineName;
    const dosage = this.currentAlarm.dosage;
    const timeSlot = this.currentAlarm.timeSlot;
    const snoozeTime = Date.now() + (minutes * 60 * 1000);

    console.log(`[AlarmService] Snoozing alarm for ${medName} by ${minutes} minutes`);

    // Stop current ringing session immediately
    await this.stopActiveAlarm('SNOOZED');

    // Schedule snooze reminder
    const snoozeAlarmId = `snooze_${medId || 'med'}_${Date.now()}`;
    await this.scheduleAlarmDirect({
      alarmId: snoozeAlarmId,
      medicineId: medId,
      medicineName: `${medName} (Snoozed)`,
      dosage,
      timeStr: `Snooze (+${minutes}m)`,
      scheduledTimestamp: snoozeTime,
      repeatDaily: false
    });
  }

  // --- Scheduling Operations ---

  async scheduleMedicationAlarm(medicine, timeStr, scheduleId, accountUserId = '') {
    if (!medicine || medicine.status === 'Inactive') return;

    const { hours, minutes } = parseArbitraryTime(timeStr);
    const now = new Date();
    const scheduledDate = new Date();
    scheduledDate.setHours(hours, minutes, 0, 0);

    // If already passed today, schedule for next occurrence (tomorrow)
    if (scheduledDate.getTime() <= now.getTime()) {
      scheduledDate.setDate(scheduledDate.getDate() + 1);
    }

    const cleanTime = timeStr.replace(/[^a-zA-Z0-9]/g, '_');
    const alarmId = `alarm_${medicine.id || medicine.name}_${cleanTime}`;

    const alarmRecord = {
      alarmId,
      medicineId: medicine.id,
      medicineName: medicine.name,
      dosage: medicine.dosage || '1 dose',
      timeStr,
      scheduledTimestamp: scheduledDate.getTime(),
      repeatDaily: true,
      accountUserId
    };

    // Save in persistent web scheduled list
    this.saveScheduledRecord(alarmRecord);

    // Schedule on Android Native AlarmManager if on native platform
    if (Capacitor.isNativePlatform()) {
      try {
        await MedAlarm.scheduleAlarm({
          id: alarmId,
          medicineId: medicine.id,
          medicineName: medicine.name,
          dosage: medicine.dosage || '1 dose',
          timeStr,
          timestamp: scheduledDate.getTime(),
          repeatDaily: true,
          accountUserId
        });
        console.log(`[AlarmService Native] Scheduled exact Android alarm for ${medicine.name} at ${scheduledDate.toLocaleTimeString()}`);
      } catch (err) {
        console.error('[AlarmService Native] Error scheduling exact alarm:', err);
      }
    } else {
      console.log(`[AlarmService Web] Scheduled reminder for ${medicine.name} at ${scheduledDate.toLocaleTimeString()}`);
    }
  }

  async scheduleAlarmDirect(record) {
    this.saveScheduledRecord(record);

    if (Capacitor.isNativePlatform()) {
      try {
        await MedAlarm.scheduleAlarm({
          id: record.alarmId,
          medicineId: record.medicineId,
          medicineName: record.medicineName,
          dosage: record.dosage,
          timeStr: record.timeStr,
          timestamp: record.scheduledTimestamp,
          repeatDaily: record.repeatDaily,
          accountUserId: record.accountUserId || ''
        });
      } catch (e) {
        console.error('[AlarmService] Native direct schedule error:', e);
      }
    }
  }

  async cancelMedicationAlarms(medicineId) {
    if (!medicineId) return;

    // Mark as inactive in local store
    this.setMedicineActive(medicineId, false);

    // If currently ringing for this medicine, stop it immediately!
    if (this.currentAlarm && this.currentAlarm.medicineId === medicineId) {
      await this.stopActiveAlarm('MEDICINE_DEACTIVATED');
    }

    // Remove from web storage
    const all = this.getScheduledAlarms();
    const remaining = all.filter(a => a.medicineId !== medicineId);
    this.saveScheduledAlarms(remaining);

    // Remove from Native Android AlarmManager
    if (Capacitor.isNativePlatform()) {
      try {
        await MedAlarm.cancelAllForMedicine({ medicineId });
      } catch (e) {
        console.warn('[AlarmService] Native cancel error:', e);
      }
    }
  }

  setMedicineActive(medicineId, isActive) {
    if (!medicineId) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_INACTIVE);
      let inactiveList = raw ? JSON.parse(raw) : [];
      if (!isActive) {
        if (!inactiveList.includes(medicineId)) {
          inactiveList.push(medicineId);
        }
        if (this.currentAlarm && this.currentAlarm.medicineId === medicineId) {
          this.stopActiveAlarm('MEDICINE_DEACTIVATED');
        }
      } else {
        inactiveList = inactiveList.filter(id => id !== medicineId);
      }
      localStorage.setItem(STORAGE_KEY_INACTIVE, JSON.stringify(inactiveList));

      if (Capacitor.isNativePlatform()) {
        MedAlarm.setMedicineActive({ medicineId, active: isActive }).catch(() => {});
      }
    } catch (e) {}
  }

  isMedicineInactive(medicineId) {
    if (!medicineId) return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_INACTIVE);
      const inactiveList = raw ? JSON.parse(raw) : [];
      return inactiveList.includes(medicineId);
    } catch (e) {
      return false;
    }
  }

  recordDismissedToday(alarmId, todayKey = new Date().toISOString().split('T')[0]) {
    if (!alarmId) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DISMISSED_TODAY);
      const store = raw ? JSON.parse(raw) : {};
      if (!store[todayKey]) store[todayKey] = [];
      if (!store[todayKey].includes(alarmId)) {
        store[todayKey].push(alarmId);
      }
      // Prune past dates
      Object.keys(store).forEach(k => {
        if (k < todayKey) delete store[k];
      });
      localStorage.setItem(STORAGE_KEY_DISMISSED_TODAY, JSON.stringify(store));
    } catch (e) {}
  }

  isDismissedToday(alarmId, todayKey = new Date().toISOString().split('T')[0]) {
    if (!alarmId) return false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DISMISSED_TODAY);
      const store = raw ? JSON.parse(raw) : {};
      return !!(store[todayKey] && store[todayKey].includes(alarmId));
    } catch (e) {
      return false;
    }
  }

  async cancelAlarmById(alarmId) {
    if (!alarmId) return;

    const all = this.getScheduledAlarms();
    const remaining = all.filter(a => a.alarmId !== alarmId);
    this.saveScheduledAlarms(remaining);

    if (Capacitor.isNativePlatform()) {
      try {
        await MedAlarm.cancelAlarm({ id: alarmId });
      } catch (e) {
        console.warn('[AlarmService] Native cancel error:', e);
      }
    }
  }

  // --- Web Fallback Ticker for Browser/PWA ---

  startWebTicker() {
    if (this.webTickInterval) clearInterval(this.webTickInterval);
    this.webTickInterval = setInterval(() => {
      const now = Date.now();
      const todayKey = new Date().toISOString().split('T')[0];
      const scheduled = this.getScheduledAlarms();

      scheduled.forEach(item => {
        // Skip inactive medicines
        if (item.medicineId && this.isMedicineInactive(item.medicineId)) {
          return;
        }

        // Skip alarms already dismissed today
        if (this.isDismissedToday(item.alarmId, todayKey)) {
          return;
        }

        // If scheduled time has arrived (within a 30s window) and not ringing
        if (now >= item.scheduledTimestamp && now - item.scheduledTimestamp < 60000) {
          if (!this.isDuplicateTrigger(item.alarmId, 60000)) {
            this.triggerAlarm(item);

            // If repeating, advance to tomorrow
            if (item.repeatDaily) {
              item.scheduledTimestamp += 86400000;
              this.saveScheduledRecord(item);
            }
          }
        }
      });
    }, 5000);
  }

  // --- Persistence & Idempotency Helpers ---

  persistActiveAlarm(record) {
    try {
      localStorage.setItem(STORAGE_KEY_ACTIVE, JSON.stringify(record));
    } catch (e) {}
  }

  clearActiveAlarmState(status) {
    this.currentAlarm = null;
    try {
      localStorage.removeItem(STORAGE_KEY_ACTIVE);
    } catch (e) {}
  }

  getScheduledAlarms() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SCHEDULED);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  saveScheduledAlarms(list) {
    try {
      localStorage.setItem(STORAGE_KEY_SCHEDULED, JSON.stringify(list));
    } catch (e) {}
  }

  saveScheduledRecord(record) {
    const list = this.getScheduledAlarms().filter(a => a.alarmId !== record.alarmId);
    list.push(record);
    this.saveScheduledAlarms(list);
  }

  isDuplicateTrigger(alarmId, windowMs) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      const history = raw ? JSON.parse(raw) : {};
      if (history[alarmId]) {
        const lastTrigger = history[alarmId].timestamp;
        if (Date.now() - lastTrigger < windowMs) {
          return true;
        }
      }
    } catch (e) {}
    return false;
  }

  recordHistory(alarmId, timestamp, action) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
      const history = raw ? JSON.parse(raw) : {};
      history[alarmId] = { timestamp, action };

      // Prune history older than 24h
      const cutoff = Date.now() - 86400000;
      Object.keys(history).forEach(k => {
        if (history[k].timestamp < cutoff) delete history[k];
      });

      localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(history));
    } catch (e) {}
  }
}

// Export singleton instance
export const alarmService = new AlarmService();
