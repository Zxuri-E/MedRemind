package com.medremind.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

import java.util.List;

/**
 * Restores scheduled medication alarms upon device reboot or system clock/timezone changes.
 */
public class MedBootReceiver extends BroadcastReceiver {

    private static final String TAG = "MedBootReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;

        String action = intent.getAction();
        Log.d(TAG, "Received system broadcast: " + action + ". Restoring scheduled medication alarms...");

        AlarmStateStore store = new AlarmStateStore(context);
        List<AlarmStateStore.AlarmRecord> scheduled = store.getAllScheduledAlarms();

        long now = System.currentTimeMillis();
        int restoredCount = 0;

        for (AlarmStateStore.AlarmRecord record : scheduled) {
            // Do not restore dismissed or expired alarms
            if ("DISMISSED".equals(record.status) || "EXPIRED".equals(record.status)) {
                continue;
            }
            // Do not restore one-time/snooze alarms that have already passed
            if (!record.repeatDaily && record.scheduledTimestamp <= now) {
                continue;
            }
            // Re-schedule alarm through scheduler
            MedAlarmScheduler.scheduleAlarm(context, record);
            restoredCount++;
        }

        Log.d(TAG, "Successfully restored " + restoredCount + " medication alarm(s) after " + action);
    }
}
