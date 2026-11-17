package com.medremind.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.List;

/**
 * Capacitor Plugin bridging web JavaScript to native Android AlarmManager and MedAlarmService.
 */
@CapacitorPlugin(name = "MedAlarm")
public class MedAlarmPlugin extends Plugin {

    @PluginMethod
    public void scheduleAlarm(PluginCall call) {
        String alarmId = call.getString("id");
        String medicineId = call.getString("medicineId");
        String medicineName = call.getString("medicineName");
        String dosage = call.getString("dosage", "1 dose");
        String timeStr = call.getString("timeStr");
        Long timestamp = call.getLong("timestamp");
        Boolean repeatDaily = call.getBoolean("repeatDaily", true);
        String accountUserId = call.getString("accountUserId", "");

        if (alarmId == null || alarmId.isEmpty()) {
            call.reject("Alarm ID is required");
            return;
        }

        if (timestamp == null || timestamp <= 0) {
            call.reject("Timestamp is required and must be positive");
            return;
        }

        Context context = getContext();
        AlarmStateStore.AlarmRecord record = new AlarmStateStore.AlarmRecord();
        record.alarmId = alarmId;
        record.medicineId = medicineId;
        record.medicineName = medicineName != null ? medicineName : "Medication Reminder";
        record.dosage = dosage;
        record.timeStr = timeStr;
        record.scheduledTimestamp = timestamp;
        record.repeatDaily = repeatDaily != null ? repeatDaily : true;
        record.accountUserId = accountUserId != null ? accountUserId : "";

        MedAlarmScheduler.scheduleAlarm(context, record);

        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("alarmId", alarmId);
        ret.put("scheduledTimestamp", record.scheduledTimestamp);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelAlarm(PluginCall call) {
        String alarmId = call.getString("id");
        if (alarmId == null || alarmId.isEmpty()) {
            call.reject("Alarm ID is required");
            return;
        }
        MedAlarmScheduler.cancelAlarm(getContext(), alarmId);
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void cancelAllForMedicine(PluginCall call) {
        String medicineId = call.getString("medicineId");
        if (medicineId == null || medicineId.isEmpty()) {
            call.reject("Medicine ID is required");
            return;
        }
        MedAlarmScheduler.cancelAllForMedicine(getContext(), medicineId);
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void setMedicineActive(PluginCall call) {
        String medicineId = call.getString("medicineId");
        Boolean active = call.getBoolean("active", true);
        if (medicineId == null || medicineId.isEmpty()) {
            call.reject("Medicine ID is required");
            return;
        }
        Context context = getContext();
        AlarmStateStore store = new AlarmStateStore(context);
        if (Boolean.TRUE.equals(active)) {
            store.markMedicineActive(medicineId);
        } else {
            store.markMedicineInactive(medicineId);
            MedAlarmScheduler.cancelAllForMedicine(context, medicineId);

            // If active alarm belongs to this medicine, stop it immediately!
            AlarmStateStore.AlarmRecord act = store.getActiveAlarm();
            if (act != null && medicineId.equals(act.medicineId)) {
                store.recordAlarmDismissed(act.alarmId);
                store.clearActiveAlarm();
                MedAlarmService.stopActiveService(context);
            }
        }
        JSObject ret = new JSObject();
        ret.put("success", true);
        ret.put("medicineId", medicineId);
        ret.put("active", active);
        call.resolve(ret);
    }

    @PluginMethod
    public void stopActiveAlarm(PluginCall call) {
        Context context = getContext();
        MedAlarmService.stopActiveService(context);

        AlarmStateStore store = new AlarmStateStore(context);
        AlarmStateStore.AlarmRecord active = store.getActiveAlarm();
        if (active != null) {
            store.recordAlarmDismissed(active.alarmId);
        }
        store.clearActiveAlarm();

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void snoozeAlarm(PluginCall call) {
        Context context = getContext();
        String alarmId = call.getString("id");
        MedAlarmService.snoozeActiveService(context);

        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void getActiveAlarm(PluginCall call) {
        AlarmStateStore store = new AlarmStateStore(getContext());
        AlarmStateStore.AlarmRecord active = store.getActiveAlarm();
        JSObject ret = new JSObject();
        if (active != null) {
            ret.put("hasActiveAlarm", true);
            ret.put("alarmId", active.alarmId);
            ret.put("medicineId", active.medicineId);
            ret.put("medicineName", active.medicineName);
            ret.put("dosage", active.dosage);
            ret.put("timeStr", active.timeStr);
            ret.put("status", active.status);
            ret.put("triggerTimestamp", active.triggerTimestamp);
            ret.put("expirationTimestamp", active.expirationTimestamp);
            ret.put("remainingSeconds", Math.max(0, (active.expirationTimestamp - System.currentTimeMillis()) / 1000));
        } else {
            ret.put("hasActiveAlarm", false);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void getScheduledAlarms(PluginCall call) {
        AlarmStateStore store = new AlarmStateStore(getContext());
        List<AlarmStateStore.AlarmRecord> list = store.getAllScheduledAlarms();
        JSArray arr = new JSArray();
        for (AlarmStateStore.AlarmRecord r : list) {
            JSObject obj = new JSObject();
            obj.put("alarmId", r.alarmId);
            obj.put("medicineId", r.medicineId);
            obj.put("medicineName", r.medicineName);
            obj.put("dosage", r.dosage);
            obj.put("timeStr", r.timeStr);
            obj.put("scheduledTimestamp", r.scheduledTimestamp);
            obj.put("repeatDaily", r.repeatDaily);
            obj.put("accountUserId", r.accountUserId);
            arr.put(obj);
        }
        JSObject ret = new JSObject();
        ret.put("alarms", arr);
        call.resolve(ret);
    }

    @PluginMethod
    public void canScheduleExactAlarms(PluginCall call) {
        boolean can = MedAlarmScheduler.canScheduleExactAlarms(getContext());
        JSObject ret = new JSObject();
        ret.put("canSchedule", can);
        call.resolve(ret);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
            intent.setData(Uri.parse("package:" + getContext().getPackageName()));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        }
        JSObject ret = new JSObject();
        ret.put("success", true);
        call.resolve(ret);
    }
}
