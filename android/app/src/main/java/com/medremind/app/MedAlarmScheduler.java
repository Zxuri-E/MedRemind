package com.medremind.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import java.util.Calendar;

/**
 * Handles precise scheduling of medication alarms via Android AlarmManager.
 * Uses setExactAndAllowWhileIdle for reliable wake-up even in Doze mode.
 */
public class MedAlarmScheduler {

    private static final String TAG = "MedAlarmScheduler";

    public static final String ACTION_TRIGGER_ALARM = "com.medremind.app.ACTION_TRIGGER_MED_ALARM";
    public static final String ACTION_STOP_ALARM = "com.medremind.app.ACTION_STOP_MED_ALARM";
    public static final String ACTION_SNOOZE_ALARM = "com.medremind.app.ACTION_SNOOZE_MED_ALARM";

    public static final String EXTRA_ALARM_ID = "extra_alarm_id";
    public static final String EXTRA_MEDICINE_ID = "extra_medicine_id";
    public static final String EXTRA_MEDICINE_NAME = "extra_medicine_name";
    public static final String EXTRA_DOSAGE = "extra_dosage";
    public static final String EXTRA_TIME_STR = "extra_time_str";
    public static final String EXTRA_REPEAT_DAILY = "extra_repeat_daily";

    public static boolean canScheduleExactAlarms(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            return alarmManager != null && alarmManager.canScheduleExactAlarms();
        }
        return true;
    }

    public static void scheduleAlarm(Context context, AlarmStateStore.AlarmRecord record) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager == null) {
            Log.e(TAG, "AlarmManager not available");
            return;
        }

        long triggerAt = record.scheduledTimestamp;
        long now = System.currentTimeMillis();

        // If trigger time has already passed today:
        // For repeating alarms: advance to the next daily occurrence.
        // For one-time/snooze alarms: do not advance; drop past-due triggers safely.
        if (triggerAt <= now) {
            if (record.repeatDaily) {
                Calendar cal = Calendar.getInstance();
                cal.setTimeInMillis(triggerAt);
                while (cal.getTimeInMillis() <= now) {
                    cal.add(Calendar.DAY_OF_YEAR, 1);
                }
                triggerAt = cal.getTimeInMillis();
                record.scheduledTimestamp = triggerAt;
            } else {
                Log.w(TAG, "One-time/snooze alarm " + record.alarmId + " scheduled in the past; skipping.");
                return;
            }
        }

        Intent intent = new Intent(context, MedAlarmReceiver.class);
        intent.setAction(ACTION_TRIGGER_ALARM);
        intent.putExtra(EXTRA_ALARM_ID, record.alarmId);
        intent.putExtra(EXTRA_MEDICINE_ID, record.medicineId);
        intent.putExtra(EXTRA_MEDICINE_NAME, record.medicineName);
        intent.putExtra(EXTRA_DOSAGE, record.dosage);
        intent.putExtra(EXTRA_TIME_STR, record.timeStr);
        intent.putExtra(EXTRA_REPEAT_DAILY, record.repeatDaily);

        // Safe non-negative request code resilient against Integer.MIN_VALUE
        int requestCode = (record.alarmId.hashCode() & 0x7FFFFFFF);
        PendingIntent pendingIntent = PendingIntent.getBroadcast(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                alarmManager.setExactAndAllowWhileIdle(
                        AlarmManager.RTC_WAKEUP,
                        triggerAt,
                        pendingIntent
                );
            } else {
                alarmManager.setExact(
                        AlarmManager.RTC_WAKEUP,
                        triggerAt,
                        pendingIntent
                );
            }
            Log.d(TAG, "Scheduled exact alarm for " + record.medicineName + " at " + triggerAt + " (ID: " + record.alarmId + ")");
        } catch (SecurityException se) {
            Log.w(TAG, "Exact alarm permission missing, falling back to inexact alarm: " + se.getMessage());
            alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent);
        }

        // Persist in state store
        AlarmStateStore store = new AlarmStateStore(context);
        if (record.medicineId != null) {
            store.markMedicineActive(record.medicineId);
        }
        store.saveScheduledAlarm(record);
    }

    public static void cancelAlarm(Context context, String alarmId) {
        AlarmManager alarmManager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (alarmManager != null && alarmId != null) {
            Intent intent = new Intent(context, MedAlarmReceiver.class);
            intent.setAction(ACTION_TRIGGER_ALARM);
            int requestCode = (alarmId.hashCode() & 0x7FFFFFFF);
            PendingIntent pendingIntent = PendingIntent.getBroadcast(
                    context,
                    requestCode,
                    intent,
                    PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE
            );
            if (pendingIntent != null) {
                alarmManager.cancel(pendingIntent);
                pendingIntent.cancel();
            }
        }

        AlarmStateStore store = new AlarmStateStore(context);
        store.removeScheduledAlarm(alarmId);
        Log.d(TAG, "Cancelled alarm " + alarmId);
    }

    public static void cancelAllForMedicine(Context context, String medicineId) {
        if (medicineId == null || medicineId.isEmpty()) return;
        AlarmStateStore store = new AlarmStateStore(context);
        store.markMedicineInactive(medicineId);

        for (AlarmStateStore.AlarmRecord a : store.getAllScheduledAlarms()) {
            if (medicineId.equals(a.medicineId)) {
                cancelAlarm(context, a.alarmId);
            }
        }
        store.removeAllForMedicine(medicineId);

        // If currently actively ringing for this medicine, stop it immediately!
        AlarmStateStore.AlarmRecord active = store.getActiveAlarm();
        if (active != null && medicineId.equals(active.medicineId)) {
            Log.d(TAG, "Halting active alarm because medicine " + medicineId + " was deactivated.");
            Intent stopIntent = new Intent(context, MedAlarmService.class);
            stopIntent.setAction(MedAlarmService.ACTION_STOP_ALARM);
            try {
                context.startService(stopIntent);
            } catch (Exception e) {
                Log.w(TAG, "Could not startService to stop alarm: " + e.getMessage());
            }
        }
    }
}
