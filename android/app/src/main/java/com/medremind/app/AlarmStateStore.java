package com.medremind.app;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.List;

/**
 * Thread-safe persistent alarm storage backed by Android SharedPreferences.
 * Stores scheduled alarms, active alarm state, and historical triggers for idempotency.
 * Independent of user authentication sessions.
 */
public class AlarmStateStore {

    private static final String PREF_NAME = "medremind_alarm_state_store";
    private static final String KEY_SCHEDULED_ALARMS = "scheduled_alarms";
    private static final String KEY_ACTIVE_ALARM = "active_alarm";
    private static final String KEY_ALARM_HISTORY = "alarm_history";
    private static final String KEY_INACTIVE_MEDICINES = "inactive_medicines";

    private final SharedPreferences prefs;

    public AlarmStateStore(Context context) {
        this.prefs = context.getApplicationContext().getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE);
    }

    public static class AlarmRecord {
        public String alarmId;
        public String medicineId;
        public String medicineName;
        public String dosage;
        public String timeStr;
        public long scheduledTimestamp;
        public long triggerTimestamp;
        public long expirationTimestamp;
        public String status; // SCHEDULED, RINGING, DISMISSED, EXPIRED, SNOOZED
        public boolean dismissed;
        public boolean repeatDaily;
        public String accountUserId;

        public JSONObject toJsonObject() throws JSONException {
            JSONObject json = new JSONObject();
            json.put("alarmId", alarmId);
            json.put("medicineId", medicineId);
            json.put("medicineName", medicineName);
            json.put("dosage", dosage);
            json.put("timeStr", timeStr);
            json.put("scheduledTimestamp", scheduledTimestamp);
            json.put("triggerTimestamp", triggerTimestamp);
            json.put("expirationTimestamp", expirationTimestamp);
            json.put("status", status);
            json.put("dismissed", dismissed);
            json.put("repeatDaily", repeatDaily);
            json.put("accountUserId", accountUserId);
            return json;
        }

        public static AlarmRecord fromJsonObject(JSONObject json) {
            AlarmRecord r = new AlarmRecord();
            r.alarmId = json.optString("alarmId");
            r.medicineId = json.optString("medicineId");
            r.medicineName = json.optString("medicineName");
            r.dosage = json.optString("dosage", "1 dose");
            r.timeStr = json.optString("timeStr");
            r.scheduledTimestamp = json.optLong("scheduledTimestamp", 0);
            r.triggerTimestamp = json.optLong("triggerTimestamp", 0);
            r.expirationTimestamp = json.optLong("expirationTimestamp", 0);
            r.status = json.optString("status", "SCHEDULED");
            r.dismissed = json.optBoolean("dismissed", false);
            r.repeatDaily = json.optBoolean("repeatDaily", true);
            r.accountUserId = json.optString("accountUserId", "");
            return r;
        }
    }

    public synchronized void saveScheduledAlarm(AlarmRecord record) {
        List<AlarmRecord> alarms = getAllScheduledAlarms();
        // Remove existing record with same ID to prevent duplication
        alarms.removeIf(a -> a.alarmId.equals(record.alarmId));
        alarms.add(record);
        persistScheduledAlarms(alarms);
    }

    public synchronized void removeScheduledAlarm(String alarmId) {
        List<AlarmRecord> alarms = getAllScheduledAlarms();
        alarms.removeIf(a -> a.alarmId.equals(alarmId));
        persistScheduledAlarms(alarms);
    }

    public synchronized void removeAllForMedicine(String medicineId) {
        if (medicineId == null || medicineId.isEmpty()) return;
        markMedicineInactive(medicineId);
        List<AlarmRecord> alarms = getAllScheduledAlarms();
        alarms.removeIf(a -> a.medicineId != null && a.medicineId.equals(medicineId));
        persistScheduledAlarms(alarms);
    }

    // --- Inactive Medicine Tracking (Prevent Deactivated Medicines from Ringing) ---

    public synchronized void markMedicineInactive(String medicineId) {
        if (medicineId == null || medicineId.trim().isEmpty()) return;
        List<String> list = getInactiveMedicines();
        if (!list.contains(medicineId)) {
            list.add(medicineId);
            persistInactiveMedicines(list);
        }
    }

    public synchronized void markMedicineActive(String medicineId) {
        if (medicineId == null || medicineId.trim().isEmpty()) return;
        List<String> list = getInactiveMedicines();
        if (list.remove(medicineId)) {
            persistInactiveMedicines(list);
        }
    }

    public synchronized boolean isMedicineInactive(String medicineId) {
        if (medicineId == null || medicineId.trim().isEmpty()) return false;
        return getInactiveMedicines().contains(medicineId);
    }

    public synchronized List<String> getInactiveMedicines() {
        List<String> list = new ArrayList<>();
        String raw = prefs.getString(KEY_INACTIVE_MEDICINES, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                list.add(arr.getString(i));
            }
        } catch (JSONException ignored) {}
        return list;
    }

    private void persistInactiveMedicines(List<String> list) {
        JSONArray arr = new JSONArray();
        for (String s : list) arr.put(s);
        prefs.edit().putString(KEY_INACTIVE_MEDICINES, arr.toString()).apply();
    }

    public synchronized void removeFutureAlarmsForAccount(String accountUserId) {
        if (accountUserId == null || accountUserId.trim().isEmpty()) return;
        List<AlarmRecord> alarms = getAllScheduledAlarms();
        alarms.removeIf(a -> accountUserId.equals(a.accountUserId));
        persistScheduledAlarms(alarms);
    }

    public synchronized List<AlarmRecord> getAllScheduledAlarms() {
        List<AlarmRecord> list = new ArrayList<>();
        String raw = prefs.getString(KEY_SCHEDULED_ALARMS, "[]");
        try {
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                list.add(AlarmRecord.fromJsonObject(arr.getJSONObject(i)));
            }
        } catch (JSONException e) {
            // Ignore parse errors
        }
        return list;
    }

    public synchronized AlarmRecord getScheduledAlarm(String alarmId) {
        for (AlarmRecord a : getAllScheduledAlarms()) {
            if (a.alarmId.equals(alarmId)) return a;
        }
        return null;
    }

    private void persistScheduledAlarms(List<AlarmRecord> alarms) {
        JSONArray arr = new JSONArray();
        for (AlarmRecord a : alarms) {
            try {
                arr.put(a.toJsonObject());
            } catch (JSONException ignored) {}
        }
        prefs.edit().putString(KEY_SCHEDULED_ALARMS, arr.toString()).apply();
    }

    // --- Active Alarm Lifecycle ---

    public synchronized void recordAlarmTriggered(AlarmRecord record, long durationMs) {
        record.status = "RINGING";
        record.triggerTimestamp = System.currentTimeMillis();
        record.expirationTimestamp = record.triggerTimestamp + durationMs;
        record.dismissed = false;

        try {
            prefs.edit().putString(KEY_ACTIVE_ALARM, record.toJsonObject().toString()).apply();
        } catch (JSONException ignored) {}

        // Record into history
        recordHistory(record.alarmId, record.triggerTimestamp, "TRIGGERED");
    }

    public synchronized AlarmRecord getActiveAlarm() {
        String raw = prefs.getString(KEY_ACTIVE_ALARM, null);
        if (raw == null) return null;
        try {
            AlarmRecord r = AlarmRecord.fromJsonObject(new JSONObject(raw));
            // Check if expired
            if ("RINGING".equals(r.status) && System.currentTimeMillis() >= r.expirationTimestamp) {
                r.status = "EXPIRED";
                recordAlarmExpired(r.alarmId);
                return null;
            }
            // Check if medicine is inactive
            if (r.medicineId != null && isMedicineInactive(r.medicineId)) {
                clearActiveAlarm();
                return null;
            }
            return r;
        } catch (JSONException e) {
            return null;
        }
    }

    public synchronized void recordAlarmDismissed(String alarmId) {
        AlarmRecord active = getActiveAlarm();
        if (active != null && active.alarmId.equals(alarmId)) {
            active.status = "DISMISSED";
            active.dismissed = true;
            try {
                prefs.edit().putString(KEY_ACTIVE_ALARM, active.toJsonObject().toString()).apply();
            } catch (JSONException ignored) {}
        }
        prefs.edit().remove(KEY_ACTIVE_ALARM).apply();
        recordHistory(alarmId, System.currentTimeMillis(), "DISMISSED");
    }

    public synchronized void recordAlarmExpired(String alarmId) {
        AlarmRecord active = getActiveAlarm();
        if (active != null && active.alarmId.equals(alarmId)) {
            active.status = "EXPIRED";
            try {
                prefs.edit().putString(KEY_ACTIVE_ALARM, active.toJsonObject().toString()).apply();
            } catch (JSONException ignored) {}
        }
        prefs.edit().remove(KEY_ACTIVE_ALARM).apply();
        recordHistory(alarmId, System.currentTimeMillis(), "EXPIRED");
    }

    public synchronized void clearActiveAlarm() {
        prefs.edit().remove(KEY_ACTIVE_ALARM).apply();
    }

    // --- Idempotency & Duplicate Prevention ---

    /**
     * Checks if this alarm was already triggered within the idempotency window (e.g. 60 seconds).
     */
    public synchronized boolean isDuplicateTrigger(String alarmId, long windowMs) {
        long now = System.currentTimeMillis();
        String raw = prefs.getString(KEY_ALARM_HISTORY, "{}");
        try {
            JSONObject history = new JSONObject(raw);
            if (history.has(alarmId)) {
                JSONObject item = history.getJSONObject(alarmId);
                long lastTrigger = item.optLong("timestamp", 0);
                if (now - lastTrigger < windowMs) {
                    return true; // Duplicate trigger within window!
                }
            }
        } catch (JSONException ignored) {}
        return false;
    }

    private void recordHistory(String alarmId, long timestamp, String action) {
        String raw = prefs.getString(KEY_ALARM_HISTORY, "{}");
        try {
            JSONObject history = new JSONObject(raw);
            JSONObject item = new JSONObject();
            item.put("timestamp", timestamp);
            item.put("action", action);
            history.put(alarmId, item);

            // Clean up entries older than 24 hours to prevent unbounded growth
            long cutoff = System.currentTimeMillis() - 86400000L;
            Iterator<String> keys = history.keys();
            List<String> toRemove = new ArrayList<>();
            while (keys.hasNext()) {
                String k = keys.next();
                JSONObject obj = history.optJSONObject(k);
                if (obj != null && obj.optLong("timestamp", 0) < cutoff) {
                    toRemove.add(k);
                }
            }
            for (String k : toRemove) history.remove(k);

            prefs.edit().putString(KEY_ALARM_HISTORY, history.toString()).apply();
        } catch (JSONException ignored) {}
    }
}
