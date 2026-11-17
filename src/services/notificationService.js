import { LocalNotifications } from '@capacitor/local-notifications';
import { Capacitor } from '@capacitor/core';
import { alarmService } from './alarmService.js';

/**
 * Hash string to positive integer ID (max 32-bit positive integer for Android Notification IDs)
 */
function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 2147483647;
}

/**
 * Parse arbitrary time format into 24-hour { hours, minutes }
 * Handles "07:05 AM", "1:35 PM", "11:45 PM", "14:30", "Morning (8:00 AM)", etc.
 */
export function parseArbitraryTime(timeStr) {
  if (!timeStr) return { hours: 8, minutes: 0 };
  const clean = timeStr.trim();

  // Pattern: 1-2 digits : 2 digits optional AM/PM
  const match = clean.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (match) {
    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const ampm = match[3] ? match[3].toUpperCase() : null;
    if (ampm === 'PM' && hours < 12) hours += 12;
    if (ampm === 'AM' && hours === 12) hours = 0;
    return { hours: Math.min(23, Math.max(0, hours)), minutes: Math.min(59, Math.max(0, minutes)) };
  }

  // Fallbacks for named periods
  const lower = clean.toLowerCase();
  if (lower.includes('morning')) return { hours: 8, minutes: 0 };
  if (lower.includes('afternoon') || lower.includes('lunch')) return { hours: 13, minutes: 0 };
  if (lower.includes('evening')) return { hours: 18, minutes: 0 };
  if (lower.includes('night') || lower.includes('bedtime')) return { hours: 22, minutes: 0 };

  return { hours: 8, minutes: 0 };
}

/**
 * Initialize Android High-Importance Notification Channel with Custom Alarm Sound & Vibration
 */
let channelsInitialized = false;
export async function initNotificationChannels() {
  if (channelsInitialized) return;

  if (Capacitor.isNativePlatform()) {
    try {
      // Create high-importance channel with alarm_chime.wav
      await LocalNotifications.createChannel({
        id: 'medremind_alarms',
        name: 'Medication Reminders & Alarms',
        description: 'Critical reminders for prescribed medication timings with alarm sound and vibration',
        importance: 5, // IMPORTANCE_HIGH (Heads-up alert, bypasses basic silence)
        sound: 'alarm_chime.wav',
        vibration: true,
        visibility: 1, // VISIBILITY_PUBLIC (Visible on locked phone screen)
        lights: true,
        lightColor: '#238B78'
      });

      // Register Notification Action Buttons (Take, Snooze, Skip)
      await LocalNotifications.registerActionTypes({
        types: [
          {
            id: 'MED_REMINDER_ACTIONS',
            actions: [
              { id: 'TAKE', title: 'Take Now', foreground: true },
              { id: 'SNOOZE_10', title: 'Snooze (10m)', foreground: false },
              { id: 'SKIP', title: 'Skip Dose', destructive: true, foreground: false }
            ]
          }
        ]
      });

      // Register listener for action button interactions
      await LocalNotifications.addListener('localNotificationActionPerformed', async (action) => {
        console.log('[Notification Action Received]', action.actionId, action.notification?.extra);
        const extra = action.notification?.extra || {};
        if (action.actionId === 'SNOOZE_10') {
          await alarmService.snoozeActiveAlarm(10);
        } else if (action.actionId === 'SKIP' || action.actionId === 'TAKE') {
          await alarmService.stopActiveAlarm('DISMISSED');
        }
      });

      // Trigger active alarm engine when notification arrives (Web only fallback; Native Android uses MedAlarmService)
      await LocalNotifications.addListener('localNotificationReceived', async (notification) => {
        console.log('[Notification Received Locally]', notification);
        if (Capacitor.isNativePlatform()) {
          // Native Android uses MedAlarmService foreground service for playback.
          // Never re-trigger in webview when entering the app.
          return;
        }
        const extra = notification.extra || {};
        if (extra.medicine) {
          const cleanTime = (extra.timeSlot || '').replace(/[^a-zA-Z0-9]/g, '_');
          await alarmService.triggerAlarm({
            alarmId: `alarm_${extra.medicineId || extra.medicine.id}_${cleanTime}`,
            medicineId: extra.medicineId || extra.medicine.id,
            medicineName: extra.medicineName || extra.medicine.name,
            dosage: extra.medicine.dosage || '1 dose',
            timeSlot: extra.timeSlot || ''
          });
        }
      });

      channelsInitialized = true;
      console.log('[Notifications] medremind_alarms channel and actions initialized successfully.');
    } catch (e) {
      console.warn('[Notifications] Channel initialization notice:', e.message);
    }
  }
}

/**
 * Request notification permissions across Android and Web
 */
export async function requestNotificationPermission() {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await LocalNotifications.requestPermissions();
      return status.display === 'granted';
    } catch (e) {
      console.warn('Native notification permission error:', e);
      return false;
    }
  } else if ('Notification' in window) {
    const perm = await Notification.requestPermission();
    return perm === 'granted';
  }
  return true;
}

/**
 * Schedule a native local notification for a medication dose
 * Guaranteed to ring with sound & vibration even when phone is locked or app is closed
 */
export async function scheduleMedicationDoseNotification(medicine, timeStr, scheduleId) {
  if (!medicine || medicine.status === 'Inactive') {
    return; // Do not schedule for inactive medicines
  }

  // Ensure medicine is marked active
  alarmService.setMedicineActive(medicine.id, true);

  await initNotificationChannels();

  // Also schedule with our dedicated 60-second Alarm Engine (Exact AlarmManager + Web Engine)
  await alarmService.scheduleMedicationAlarm(medicine, timeStr, scheduleId, medicine.userId || '');

  const { hours, minutes } = parseArbitraryTime(timeStr);
  const now = new Date();
  const scheduledDate = new Date();
  scheduledDate.setHours(hours, minutes, 0, 0);

  // If time has already passed today, schedule for next occurrence (tomorrow)
  if (scheduledDate.getTime() <= now.getTime()) {
    scheduledDate.setDate(scheduledDate.getDate() + 1);
  }

  const notifId = hashCode(`${medicine.id || medicine.name}_${timeStr}`);

  if (Capacitor.isNativePlatform()) {
    try {
      const hasPerm = await requestNotificationPermission();
      if (!hasPerm) {
        console.warn('Notification permission not granted');
        return;
      }

      await LocalNotifications.schedule({
        notifications: [
          {
            id: notifId,
            title: `Medication Reminder: ${medicine.name}`,
            body: `Scheduled for ${timeStr} • ${medicine.dosage || '1 dose'}${medicine.instructions ? ` • ${medicine.instructions}` : ''}`,
            schedule: { 
              at: scheduledDate, 
              repeats: true, 
              every: 'day',
              allowWhileIdle: true 
            },
            sound: 'alarm_chime.wav',
            channelId: 'medremind_alarms',
            actionTypeId: 'MED_REMINDER_ACTIONS',
            extra: {
              medicineId: medicine.id,
              medicineName: medicine.name,
              medicine,
              timeSlot: timeStr,
              scheduleId: scheduleId || notifId
            }
          }
        ]
      });

      console.log(`[Alarm Service] Scheduled alarm for ${medicine.name} at ${scheduledDate.toLocaleTimeString()} (ID: ${notifId})`);
    } catch (err) {
      console.error('Failed to schedule local notification:', err);
    }
  } else {
    console.log(`[Web Notification Engine] Scheduled ${medicine.name} at ${scheduledDate.toLocaleTimeString()}`);
  }
}

/**
 * Snooze a reminder by 5, 10, or 15 minutes
 * Cancels existing snooze duplicate before rescheduling
 */
export async function snoozeNotification(medicine, timeSlot, minutes = 10) {
  if (!medicine || medicine.status === 'Inactive') {
    return;
  }

  await initNotificationChannels();
  await alarmService.snoozeActiveAlarm(minutes);

  const snoozeId = hashCode(`snooze_${medicine.id || medicine.name}_${timeSlot}`);
  const snoozeDate = new Date(Date.now() + minutes * 60 * 1000);

  if (Capacitor.isNativePlatform()) {
    try {
      // Cancel previous snooze for this medicine/slot to prevent duplicates
      await LocalNotifications.cancel({ notifications: [{ id: snoozeId }] }).catch(() => {});

      await LocalNotifications.schedule({
        notifications: [
          {
            id: snoozeId,
            title: `Snoozed Reminder: ${medicine.name}`,
            body: `Snoozed for ${minutes}m • ${medicine.dosage || '1 dose'} is due now.`,
            schedule: { 
              at: snoozeDate, 
              allowWhileIdle: true 
            },
            sound: 'alarm_chime.wav',
            channelId: 'medremind_alarms',
            actionTypeId: 'MED_REMINDER_ACTIONS',
            extra: {
              medicineId: medicine.id,
              medicine,
              timeSlot,
              isSnooze: true
            }
          }
        ]
      });
      console.log(`[Alarm Service] Snoozed reminder for ${medicine.name} to ${snoozeDate.toLocaleTimeString()}`);
    } catch (e) {
      console.error('Error scheduling snooze notification:', e);
    }
  }
}

/**
 * Cancel all scheduled notifications for a specific medicine (used when deactivated or deleted)
 */
export async function cancelMedicationNotifications(medicineId, timeSlots = []) {
  if (!medicineId) return;

  // Mark inactive in alarm engine and native store
  alarmService.setMedicineActive(medicineId, false);

  // Cancel from our dedicated alarm engine
  await alarmService.cancelMedicationAlarms(medicineId);

  if (!Capacitor.isNativePlatform()) return;

  try {
    const pending = await LocalNotifications.getPending();
    if (pending && pending.notifications) {
      const toCancel = pending.notifications.filter(n => {
        return n.extra?.medicineId === medicineId || n.extra?.medicine?.id === medicineId;
      });

      if (toCancel.length > 0) {
        await LocalNotifications.cancel({
          notifications: toCancel.map(n => ({ id: n.id }))
        });
        console.log(`[Alarm Service] Cancelled ${toCancel.length} notification(s) for medicine ${medicineId}`);
      }
    }
  } catch (err) {
    console.warn('Error cancelling medication notifications:', err);
  }
}

/**
 * Cancel all scheduled medication notifications across all slots and medicines
 * (Used on logout to prevent previous user's alarms from firing for a different user)
 */
export async function cancelAllMedicationNotifications() {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const pending = await LocalNotifications.getPending();
    if (pending && pending.notifications && pending.notifications.length > 0) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map(n => ({ id: n.id }))
      });
      console.log(`[NotificationService] Cancelled ${pending.notifications.length} pending notification(s) on account switch.`);
    }
  } catch (err) {
    console.warn('[NotificationService] Error cancelling all notifications:', err);
  }
}

/**
 * Send an immediate test or urgent alert notification
 */
export async function sendImmediateNotification(title, body) {
  await initNotificationChannels();

  if (Capacitor.isNativePlatform()) {
    try {
      const hasPerm = await requestNotificationPermission();
      if (!hasPerm) return;

      await LocalNotifications.schedule({
        notifications: [
          {
            id: Math.floor(Math.random() * 900000) + 100000,
            title,
            body,
            schedule: { at: new Date(Date.now() + 500) },
            channelId: 'medremind_alarms',
            sound: 'alarm_chime.wav'
          }
        ]
      });
    } catch (e) {
      console.warn('Native immediate notification error:', e);
    }
  } else if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body });
  }
}
