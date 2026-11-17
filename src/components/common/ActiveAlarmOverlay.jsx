import React, { useState, useEffect } from 'react';
import { alarmService } from '../../services/alarmService';
import { Bell, BellRing, Clock, CheckCircle2, RotateCcw } from 'lucide-react';

export default function ActiveAlarmOverlay() {
  const [alarmState, setAlarmState] = useState(() => alarmService.getState());

  useEffect(() => {
    const unsubscribe = alarmService.subscribe(state => {
      setAlarmState(state);
    });
    return () => unsubscribe();
  }, []);

  if (!alarmState.isRinging || !alarmState.activeAlarm) {
    return null;
  }

  const { activeAlarm, remainingSeconds } = alarmState;
  const progressPercent = Math.max(0, Math.min(100, (remainingSeconds / 60) * 100));

  const handleStop = () => {
    alarmService.stopActiveAlarm('DISMISSED');
  };

  const handleSnooze = () => {
    alarmService.snoozeActiveAlarm(10);
  };

  return (
    <div 
      className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-label="Medication Alarm Ringing"
    >
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-3xl shadow-2xl border-4 border-red-500/80 overflow-hidden transform transition-all p-6 text-center animate-bounce-short">
        
        {/* Pulsating Bell Badge */}
        <div className="relative mx-auto mb-4 w-20 h-20 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
          <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-red-600 to-rose-500 flex items-center justify-center shadow-lg shadow-red-500/30">
            <BellRing className="w-10 h-10 text-white animate-wiggle" />
          </div>
        </div>

        {/* Heading */}
        <span className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 mb-2">
          Medication Due Now • 60s Duration
        </span>

        {/* Medicine Name */}
        <h2 className="text-2xl sm:text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight mb-1">
          {activeAlarm.medicineName}
        </h2>

        {/* Dosage & Timing */}
        <p className="text-base text-gray-600 dark:text-gray-300 font-medium mb-4">
          {activeAlarm.dosage || '1 dose'} 
          {activeAlarm.timeSlot ? ` • Scheduled for ${activeAlarm.timeSlot}` : ''}
        </p>

        {/* Countdown Timer & Progress Bar */}
        <div className="bg-gray-100 dark:bg-gray-800 rounded-2xl p-4 mb-6">
          <div className="flex items-center justify-between text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            <span className="flex items-center gap-1.5">
              <Clock className="w-4 h-4 text-red-500" />
              Auto-stopping in:
            </span>
            <span className="text-lg font-mono font-bold text-red-600 dark:text-red-400">
              {remainingSeconds}s
            </span>
          </div>

          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5 overflow-hidden">
            <div 
              className="bg-gradient-to-r from-red-500 to-amber-500 h-2.5 rounded-full transition-all duration-1000 ease-linear"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleStop}
            className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold text-lg shadow-lg shadow-red-600/30 transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-6 h-6" />
            DISMISS / STOP
          </button>

          <button
            onClick={handleSnooze}
            className="flex-1 flex items-center justify-center gap-2 py-4 px-6 rounded-2xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700 active:scale-95 text-gray-800 dark:text-gray-200 font-bold text-lg transition-all cursor-pointer"
          >
            <RotateCcw className="w-5 h-5 text-gray-500 dark:text-gray-400" />
            Snooze (10m)
          </button>
        </div>

        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
          Alarm continues ringing across logout and screen lock until 60s expires or dismissed.
        </p>
      </div>
    </div>
  );
}
