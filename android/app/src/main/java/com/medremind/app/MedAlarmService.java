package com.medremind.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;

/**
 * Foreground Service responsible for active medication alarm playback.
 * Enforces the strict 60-second duration requirement, looping audio, vibration,
 * persistent notifications with actions, and survival across user logout and process changes.
 */
public class MedAlarmService extends Service {

    private static final String TAG = "MedAlarmService";

    public static final String ACTION_START_ALARM = "com.medremind.app.ACTION_START_ALARM";
    public static final String ACTION_STOP_ALARM = "com.medremind.app.ACTION_STOP_ALARM";
    public static final String ACTION_SNOOZE_ALARM = "com.medremind.app.ACTION_SNOOZE_ALARM";

    public static final String CHANNEL_ID = "medremind_active_alarm_channel";
    public static final int NOTIFICATION_ID = 202611;
    public static final long EXACT_ALARM_DURATION_MS = 60000L; // Exactly 60 seconds

    private static MedAlarmService activeInstance;

    private MediaPlayer mediaPlayer;
    private Vibrator vibrator;
    private AudioManager audioManager;
    private AudioFocusRequest audioFocusRequest;
    private Handler autoStopHandler;
    private Runnable autoStopRunnable;

    private String currentAlarmId;
    private String currentMedicineId;
    private String currentMedicineName;
    private String currentDosage;
    private String currentTimeStr;
    private boolean isRinging = false;

    public static synchronized void stopActiveService(Context context) {
        Log.d(TAG, "stopActiveService invoked, activeInstance=" + (activeInstance != null));
        if (activeInstance != null) {
            activeInstance.handleStopAlarm();
        } else {
            try {
                AlarmStateStore store = new AlarmStateStore(context);
                AlarmStateStore.AlarmRecord act = store.getActiveAlarm();
                if (act != null) {
                    store.recordAlarmDismissed(act.alarmId);
                }
                store.clearActiveAlarm();
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                if (nm != null) {
                    nm.cancel(NOTIFICATION_ID);
                }
                Intent stopIntent = new Intent(context, MedAlarmService.class);
                stopIntent.setAction(ACTION_STOP_ALARM);
                context.stopService(stopIntent);
            } catch (Exception ignored) {}
        }
    }

    public static synchronized void snoozeActiveService(Context context) {
        Log.d(TAG, "snoozeActiveService invoked, activeInstance=" + (activeInstance != null));
        if (activeInstance != null) {
            activeInstance.handleSnoozeAlarm();
        }
    }

    public static synchronized boolean isCurrentlyRinging() {
        return activeInstance != null && activeInstance.isRinging;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        createNotificationChannel();
        autoStopHandler = new Handler(Looper.getMainLooper());
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        Log.d(TAG, "onStartCommand action: " + action);

        if (ACTION_START_ALARM.equals(action)) {
            handleStartAlarm(intent);
        } else if (ACTION_STOP_ALARM.equals(action)) {
            handleStopAlarm();
        } else if (ACTION_SNOOZE_ALARM.equals(action)) {
            handleSnoozeAlarm();
        }

        return START_NOT_STICKY;
    }

    private void handleStartAlarm(Intent intent) {
        String alarmId = intent.getStringExtra(MedAlarmScheduler.EXTRA_ALARM_ID);
        String medicineId = intent.getStringExtra(MedAlarmScheduler.EXTRA_MEDICINE_ID);
        String medicineName = intent.getStringExtra(MedAlarmScheduler.EXTRA_MEDICINE_NAME);
        String dosage = intent.getStringExtra(MedAlarmScheduler.EXTRA_DOSAGE);
        String timeStr = intent.getStringExtra(MedAlarmScheduler.EXTRA_TIME_STR);

        // If an alarm is already actively ringing, merge and update rather than interrupting playback
        if (isRinging && mediaPlayer != null && mediaPlayer.isPlaying()) {
            Log.d(TAG, "Concurrent alarm arrived while active. Merging reminder details.");
            currentMedicineName = currentMedicineName + " & " + (medicineName != null ? medicineName : "Medication");
            currentDosage = currentDosage + " + " + (dosage != null ? dosage : "1 dose");

            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.notify(NOTIFICATION_ID, buildForegroundNotification());
            }

            if (autoStopHandler != null && autoStopRunnable != null) {
                autoStopHandler.removeCallbacks(autoStopRunnable);
                autoStopHandler.postDelayed(autoStopRunnable, EXACT_ALARM_DURATION_MS);
            }
            return;
        }

        if (isRinging) {
            stopAlarmPlayback();
        }

        currentAlarmId = alarmId != null ? alarmId : "alarm_" + System.currentTimeMillis();
        currentMedicineId = medicineId;
        currentMedicineName = medicineName != null ? medicineName : "Medication Reminder";
        currentDosage = dosage != null ? dosage : "1 dose";
        currentTimeStr = timeStr;

        // Persist active alarm state in AlarmStateStore
        AlarmStateStore store = new AlarmStateStore(this);

        // ABORT IF MEDICINE IS INACTIVE
        if (medicineId != null && store.isMedicineInactive(medicineId)) {
            Log.w(TAG, "Aborting alarm start: medicine " + medicineId + " is inactive.");
            stopSelf();
            return;
        }

        AlarmStateStore.AlarmRecord record = new AlarmStateStore.AlarmRecord();
        record.alarmId = currentAlarmId;
        record.medicineId = currentMedicineId;
        record.medicineName = currentMedicineName;
        record.dosage = currentDosage;
        record.timeStr = currentTimeStr;
        store.recordAlarmTriggered(record, EXACT_ALARM_DURATION_MS);

        // Start Foreground Service with Persistent Notification
        Notification notification = buildForegroundNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }

        // Start looping audio and vibration
        startAlarmPlayback();

        // Enforce STRICT 60-SECOND DURATION
        autoStopRunnable = () -> {
            Log.d(TAG, "Strict 60-second alarm duration reached. Auto-stopping alarm.");
            AlarmStateStore s = new AlarmStateStore(MedAlarmService.this);
            s.recordAlarmExpired(currentAlarmId);
            stopAlarmPlayback();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.cancel(NOTIFICATION_ID);
            }
            stopSelf();
        };
        autoStopHandler.postDelayed(autoStopRunnable, EXACT_ALARM_DURATION_MS);
        isRinging = true;
    }

    private void handleStopAlarm() {
        Log.d(TAG, "User explicitly stopped/dismissed alarm: " + currentAlarmId);
        AlarmStateStore store = new AlarmStateStore(this);
        if (currentAlarmId != null) {
            store.recordAlarmDismissed(currentAlarmId);
        }
        stopAlarmPlayback();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(NOTIFICATION_ID);
        }
        stopSelf();
    }

    private void handleSnoozeAlarm() {
        Log.d(TAG, "User snoozed alarm: " + currentAlarmId + " for 10 minutes");
        AlarmStateStore store = new AlarmStateStore(this);
        if (currentAlarmId != null) {
            store.recordAlarmDismissed(currentAlarmId);

            // Schedule a new alarm for 10 minutes from now (only if medicine is still active)
            if (currentMedicineId == null || !store.isMedicineInactive(currentMedicineId)) {
                AlarmStateStore.AlarmRecord snoozeRecord = new AlarmStateStore.AlarmRecord();
                snoozeRecord.alarmId = "snooze_" + currentAlarmId + "_" + System.currentTimeMillis();
                snoozeRecord.medicineId = currentMedicineId;
                snoozeRecord.medicineName = currentMedicineName + " (Snoozed)";
                snoozeRecord.dosage = currentDosage;
                snoozeRecord.timeStr = currentTimeStr;
                snoozeRecord.scheduledTimestamp = System.currentTimeMillis() + (10 * 60 * 1000L); // 10 minutes
                snoozeRecord.repeatDaily = false;

                MedAlarmScheduler.scheduleAlarm(this, snoozeRecord);
            }
        }
        stopAlarmPlayback();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE);
        } else {
            stopForeground(true);
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.cancel(NOTIFICATION_ID);
        }
        stopSelf();
    }

    private void startAlarmPlayback() {
        try {
            requestAudioFocus();

            // Initialize MediaPlayer with alarm_chime.wav
            mediaPlayer = MediaPlayer.create(this, R.raw.alarm_chime);
            if (mediaPlayer != null) {
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                mediaPlayer.setAudioAttributes(audioAttributes);
                mediaPlayer.setLooping(true); // Loops continuously for 60 seconds
                mediaPlayer.start();
                Log.d(TAG, "MediaPlayer started looping alarm sound.");
            } else {
                Log.w(TAG, "MediaPlayer failed to initialize with R.raw.alarm_chime.");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing alarm audio: " + e.getMessage(), e);
        }

        // Start vibration
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vibratorManager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vibratorManager != null) vibrator = vibratorManager.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }

            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = {0, 1000, 500, 1000, 500};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Vibrator error: " + e.getMessage());
        }
    }

    private void stopAlarmPlayback() {
        if (autoStopHandler != null && autoStopRunnable != null) {
            autoStopHandler.removeCallbacks(autoStopRunnable);
            autoStopRunnable = null;
        }

        if (mediaPlayer != null) {
            try {
                if (mediaPlayer.isPlaying()) {
                    mediaPlayer.stop();
                }
                mediaPlayer.reset();
                mediaPlayer.release();
            } catch (Exception ignored) {}
            mediaPlayer = null;
        }

        if (vibrator != null) {
            try {
                vibrator.cancel();
            } catch (Exception ignored) {}
            vibrator = null;
        }

        abandonAudioFocus();
        isRinging = false;
        Log.d(TAG, "Alarm playback and vibration stopped.");
    }

    private void requestAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attributes = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build();
                audioFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                        .setAudioAttributes(attributes)
                        .setOnAudioFocusChangeListener(focusChange -> {})
                        .build();
                audioManager.requestAudioFocus(audioFocusRequest);
            } else {
                audioManager.requestAudioFocus(null, AudioManager.STREAM_ALARM, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
            }
        } catch (Exception ignored) {}
    }

    private void abandonAudioFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && audioFocusRequest != null) {
                audioManager.abandonAudioFocusRequest(audioFocusRequest);
            } else {
                audioManager.abandonAudioFocus(null);
            }
        } catch (Exception ignored) {}
    }

    private Notification buildForegroundNotification() {
        // Broadcast PendingIntent for Stop action (Reliable across Android 12+, 13, 14, 15)
        Intent stopIntent = new Intent(this, MedAlarmReceiver.class);
        stopIntent.setAction(MedAlarmScheduler.ACTION_STOP_ALARM);
        stopIntent.putExtra(MedAlarmScheduler.EXTRA_ALARM_ID, currentAlarmId);
        stopIntent.putExtra(MedAlarmScheduler.EXTRA_MEDICINE_ID, currentMedicineId);
        PendingIntent stopPendingIntent = PendingIntent.getBroadcast(
                this,
                101,
                stopIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Broadcast PendingIntent for Snooze action
        Intent snoozeIntent = new Intent(this, MedAlarmReceiver.class);
        snoozeIntent.setAction(MedAlarmScheduler.ACTION_SNOOZE_ALARM);
        snoozeIntent.putExtra(MedAlarmScheduler.EXTRA_ALARM_ID, currentAlarmId);
        snoozeIntent.putExtra(MedAlarmScheduler.EXTRA_MEDICINE_ID, currentMedicineId);
        PendingIntent snoozePendingIntent = PendingIntent.getBroadcast(
                this,
                102,
                snoozeIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Open app action
        Intent openAppIntent = new Intent(this, MainActivity.class);
        openAppIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openAppPendingIntent = PendingIntent.getActivity(
                this,
                103,
                openAppIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle("DUE NOW: " + currentMedicineName)
                .setContentText("Dose: " + currentDosage + (currentTimeStr != null ? " • " + currentTimeStr : "") + " (Rings for 60s)")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setContentIntent(openAppPendingIntent)
                .setFullScreenIntent(openAppPendingIntent, true)
                .setDeleteIntent(stopPendingIntent)
                .addAction(R.mipmap.ic_launcher, "DISMISS / STOP", stopPendingIntent)
                .addAction(R.mipmap.ic_launcher, "SNOOZE (10m)", snoozePendingIntent);

        return builder.build();
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) {
                NotificationChannel channel = new NotificationChannel(
                        CHANNEL_ID,
                        "Medication Alarms",
                        NotificationManager.IMPORTANCE_HIGH
                );
                channel.setDescription("Critical medication reminder alarms that ring continuously for 60 seconds.");
                channel.enableVibration(true);
                channel.setBypassDnd(true);
                channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                manager.createNotificationChannel(channel);
            }
        }
    }

    @Override
    public void onDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        stopAlarmPlayback();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
