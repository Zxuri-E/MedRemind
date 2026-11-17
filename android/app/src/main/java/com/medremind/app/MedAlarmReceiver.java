package com.medremind.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;
import androidx.core.content.ContextCompat;

/**
 * Handles incoming alarm events from AlarmManager and notification action clicks.
 * Ensures idempotency and launches MedAlarmService as a Foreground Service.
 */
public class MedAlarmReceiver extends BroadcastReceiver {

    private static final String TAG = "MedAlarmReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String action = intent.getAction();
        Log.d(TAG, "onReceive action: " + action);

        if (MedAlarmScheduler.ACTION_TRIGGER_ALARM.equals(action)) {
            handleTriggerAlarm(context, intent);
        } else if (MedAlarmScheduler.ACTION_STOP_ALARM.equals(action)) {
            handleStopAlarm(context, intent);
        } else if (MedAlarmScheduler.ACTION_SNOOZE_ALARM.equals(action)) {
            handleSnoozeAlarm(context, intent);
        }
    }

    private void handleTriggerAlarm(Context context, Intent intent) {
        String alarmId = intent.getStringExtra(MedAlarmScheduler.EXTRA_ALARM_ID);
        String medicineId = intent.getStringExtra(MedAlarmScheduler.EXTRA_MEDICINE_ID);
        String medicineName = intent.getStringExtra(MedAlarmScheduler.EXTRA_MEDICINE_NAME);
        String dosage = intent.getStringExtra(MedAlarmScheduler.EXTRA_DOSAGE);
        String timeStr = intent.getStringExtra(MedAlarmScheduler.EXTRA_TIME_STR);
        boolean repeatDaily = intent.getBooleanExtra(MedAlarmScheduler.EXTRA_REPEAT_DAILY, true);

        if (alarmId == null || alarmId.isEmpty()) {
            alarmId = "alarm_" + System.currentTimeMillis();
        }

        AlarmStateStore store = new AlarmStateStore(context);

        // CHECK IF MEDICINE IS INACTIVE OR CANCELLED
        if (medicineId != null && store.isMedicineInactive(medicineId)) {
            Log.w(TAG, "Dropping alarm trigger because medicine is INACTIVE: " + medicineId + " (alarm: " + alarmId + ")");
            MedAlarmScheduler.cancelAlarm(context, alarmId);
            return;
        }

        // Check if alarm was deleted from scheduled list
        if (store.getScheduledAlarm(alarmId) == null) {
            Log.w(TAG, "Dropping alarm trigger because alarm was cancelled/deleted: " + alarmId);
            return;
        }

        // IDEMPOTENCY CHECK: ignore duplicate triggers within 60 seconds
        if (store.isDuplicateTrigger(alarmId, 60000L)) {
            Log.w(TAG, "Duplicate trigger detected for alarm " + alarmId + " within 60s, ignoring.");
            return;
        }

        AlarmStateStore.AlarmRecord record = new AlarmStateStore.AlarmRecord();
        record.alarmId = alarmId;
        record.medicineId = medicineId;
        record.medicineName = medicineName != null ? medicineName : "Medication Reminder";
        record.dosage = dosage != null ? dosage : "1 dose";
        record.timeStr = timeStr;
        record.repeatDaily = repeatDaily;
        record.scheduledTimestamp = System.currentTimeMillis();

        // Launch Foreground Alarm Service
        Intent serviceIntent = new Intent(context, MedAlarmService.class);
        serviceIntent.setAction(MedAlarmService.ACTION_START_ALARM);
        serviceIntent.putExtra(MedAlarmScheduler.EXTRA_ALARM_ID, record.alarmId);
        serviceIntent.putExtra(MedAlarmScheduler.EXTRA_MEDICINE_ID, record.medicineId);
        serviceIntent.putExtra(MedAlarmScheduler.EXTRA_MEDICINE_NAME, record.medicineName);
        serviceIntent.putExtra(MedAlarmScheduler.EXTRA_DOSAGE, record.dosage);
        serviceIntent.putExtra(MedAlarmScheduler.EXTRA_TIME_STR, record.timeStr);

        try {
            ContextCompat.startForegroundService(context, serviceIntent);
        } catch (Exception e) {
            Log.e(TAG, "Failed to start foreground alarm service: " + e.getMessage(), e);
        }

        // If daily repeating, reschedule for tomorrow (only if medicine is still active)
        if (repeatDaily && (medicineId == null || !store.isMedicineInactive(medicineId))) {
            java.util.Calendar cal = java.util.Calendar.getInstance();
            cal.setTimeInMillis(record.scheduledTimestamp);
            cal.add(java.util.Calendar.DAY_OF_YEAR, 1);
            record.scheduledTimestamp = cal.getTimeInMillis();
            MedAlarmScheduler.scheduleAlarm(context, record);
        }
    }

    private void handleStopAlarm(Context context, Intent intent) {
        String alarmId = intent.getStringExtra(MedAlarmScheduler.EXTRA_ALARM_ID);
        Log.d(TAG, "Explicitly stopping alarm via receiver: " + alarmId);

        AlarmStateStore store = new AlarmStateStore(context);
        if (alarmId != null) {
            store.recordAlarmDismissed(alarmId);
        } else {
            AlarmStateStore.AlarmRecord act = store.getActiveAlarm();
            if (act != null) {
                store.recordAlarmDismissed(act.alarmId);
            }
        }
        store.clearActiveAlarm();

        MedAlarmService.stopActiveService(context);
    }

    private void handleSnoozeAlarm(Context context, Intent intent) {
        String alarmId = intent.getStringExtra(MedAlarmScheduler.EXTRA_ALARM_ID);
        Log.d(TAG, "Snoozing alarm via receiver: " + alarmId);

        MedAlarmService.snoozeActiveService(context);
    }
}
