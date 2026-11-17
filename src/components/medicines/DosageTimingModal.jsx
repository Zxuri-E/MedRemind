import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { 
  Clock, 
  Plus, 
  Trash2, 
  Check, 
  AlertCircle, 
  Sparkles,
  Sun,
  Sunset,
  Moon,
  Coffee
} from 'lucide-react';
import { parseArbitraryTime, getSlotNameForTime } from '../../utils/scheduleSlotUtils';
import { toast } from 'sonner';

/**
 * Converts { hours, minutes } to 24h "HH:mm" string
 */
function to24HourString(hours, minutes) {
  const h = hours.toString().padStart(2, '0');
  const m = minutes.toString().padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Formats { hours, minutes } to standard display: "Morning (8:00 AM)"
 */
function toStandardTimingString(hours, minutes) {
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const displayH = hours % 12 || 12;
  const displayM = minutes.toString().padStart(2, '0');
  const time12 = `${displayH}:${displayM} ${ampm}`;
  const slotName = getSlotNameForTime(`${hours}:${minutes}`);
  return `${slotName} (${time12})`;
}

/**
 * Derives frequency label from dose count
 */
function getFrequencyForCount(count) {
  if (count === 1) return 'Once daily';
  if (count === 2) return 'Twice daily';
  if (count === 3) return 'Three times daily';
  if (count === 4) return 'Four times daily';
  return `${count} times daily`;
}

export default function DosageTimingModal({ 
  isOpen, 
  onClose, 
  medicine, 
  onSave 
}) {
  const [timesList, setTimesList] = useState([]);
  const [newTimeInput, setNewTimeInput] = useState('08:00');

  useEffect(() => {
    if (medicine && isOpen) {
      const rawTimes = Array.isArray(medicine.timeSlots) && medicine.timeSlots.length > 0
        ? medicine.timeSlots
        : Array.isArray(medicine.times) && medicine.times.length > 0
          ? medicine.times
          : ['Morning (8:00 AM)'];

      // Convert to clean list of objects with 24h strings
      const parsed = rawTimes.map((t, index) => {
        const { hours, minutes } = parseArbitraryTime(t);
        return {
          id: `time-${index}-${Date.now()}`,
          time24: to24HourString(hours, minutes),
          display: toStandardTimingString(hours, minutes)
        };
      });

      setTimesList(parsed);
    }
  }, [medicine, isOpen]);

  if (!medicine) return null;

  const handleUpdateTime = (index, newTime24) => {
    if (!newTime24) return;
    const [h, m] = newTime24.split(':').map(Number);
    const updatedDisplay = toStandardTimingString(h, m);

    setTimesList(prev => {
      const copy = [...prev];
      copy[index] = {
        ...copy[index],
        time24: newTime24,
        display: updatedDisplay
      };
      return copy;
    });
  };

  const handleRemoveTime = (index) => {
    if (timesList.length <= 1) {
      toast.warning('A medication routine must have at least one dose timing.');
      return;
    }
    setTimesList(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddTime = (time24) => {
    if (!time24) return;
    const [h, m] = time24.split(':').map(Number);
    const display = toStandardTimingString(h, m);

    // Prevent duplicate exact same timing
    const exists = timesList.some(t => t.time24 === time24);
    if (exists) {
      toast.info(`A dose is already scheduled for ${display}.`);
      return;
    }

    const newItem = {
      id: `time-${Date.now()}-${Math.random()}`,
      time24,
      display
    };

    setTimesList(prev => [...prev, newItem].sort((a, b) => a.time24.localeCompare(b.time24)));
    toast.success(`Added dose: ${display}`);
  };

  const handleSave = () => {
    if (timesList.length === 0) {
      toast.error('Please specify at least one dosage timing.');
      return;
    }

    // Sort chronologically by 24h time
    const sorted = [...timesList].sort((a, b) => a.time24.localeCompare(b.time24));
    const formattedSlots = sorted.map(t => t.display);

    // Calculate updated dose counts
    let morningCount = 0;
    let afternoonCount = 0;
    let nightCount = 0;

    sorted.forEach(t => {
      const [h] = t.time24.split(':').map(Number);
      if (h >= 4 && h < 12) morningCount += 1;
      else if (h >= 12 && h < 17) afternoonCount += 1;
      else nightCount += 1;
    });

    const updatedData = {
      ...medicine,
      timeSlots: formattedSlots,
      times: formattedSlots,
      frequency: getFrequencyForCount(formattedSlots.length),
      morningDose: morningCount,
      afternoonDose: afternoonCount,
      nightDose: nightCount,
      lastUpdated: new Date().toISOString()
    };

    if (onSave) {
      onSave(updatedData);
    }

    toast.success(`Dosage timings updated for ${medicine.name}!`);
    onClose();
  };

  const getSlotIcon = (time24) => {
    const [h] = time24.split(':').map(Number);
    if (h >= 4 && h < 12) return <Coffee className="w-3.5 h-3.5 text-amber-600" />;
    if (h >= 12 && h < 17) return <Sun className="w-3.5 h-3.5 text-orange-500" />;
    if (h >= 17 && h < 21) return <Sunset className="w-3.5 h-3.5 text-purple-600" />;
    return <Moon className="w-3.5 h-3.5 text-indigo-600" />;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Dosage Timings"
    >
      <div className="space-y-4">
        {/* Medicine Summary Header */}
        <div className="p-3 rounded-xl bg-[#DDEFE8]/40 border border-[#238B78]/20 flex items-center justify-between">
          <div>
            <h4 className="font-bold text-sm text-[#202B28]">{medicine.name}</h4>
            <p className="text-xs text-[#7A8782]">{medicine.dosage} • {medicine.form || 'Tablet'}</p>
          </div>
          <span className="text-[11px] font-bold text-[#238B78] bg-white px-2.5 py-1 rounded-lg border border-[#238B78]/30 shadow-xs">
            {getFrequencyForCount(timesList.length)}
          </span>
        </div>

        {/* Existing Timings List */}
        <div className="space-y-2">
          <label className="block text-xs font-bold text-[#202B28] uppercase tracking-wider">
            Active Dose Schedule ({timesList.length})
          </label>
          <p className="text-[11px] text-[#7A8782]">
            Modify scheduled hours & minutes. Alarms and reminders will update automatically.
          </p>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {timesList.map((item, index) => (
              <div 
                key={item.id}
                className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-[#E6ECE8] shadow-xs hover:border-[#238B78]/50 transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 border border-gray-100">
                    {getSlotIcon(item.time24)}
                  </div>
                  <div>
                    <input
                      type="time"
                      value={item.time24}
                      onChange={(e) => handleUpdateTime(index, e.target.value)}
                      className="px-2 py-1 rounded-lg bg-gray-50 border border-gray-200 text-xs font-mono font-bold text-[#202B28] focus:bg-white focus:outline-none focus:border-[#238B78]"
                    />
                    <span className="text-[11px] font-semibold text-[#238B78] ml-2">
                      {item.display}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => handleRemoveTime(index)}
                  disabled={timesList.length <= 1}
                  title={timesList.length <= 1 ? "At least one dose time required" : "Remove dose time"}
                  className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                    timesList.length <= 1 
                      ? 'text-gray-300 cursor-not-allowed' 
                      : 'text-gray-400 hover:text-red-600 hover:bg-red-50'
                  }`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Add New Dose Time Section */}
        <div className="p-3 rounded-xl bg-[#F8FAF8] border border-[#E6ECE8] space-y-2.5">
          <span className="text-xs font-bold text-[#202B28] block">Add Another Dose Time</span>
          
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={newTimeInput}
              onChange={(e) => setNewTimeInput(e.target.value)}
              className="px-3 py-2 rounded-xl bg-white border border-[#E6ECE8] text-xs font-mono font-bold text-[#202B28] focus:outline-none focus:border-[#238B78]"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              icon={Plus}
              onClick={() => handleAddTime(newTimeInput)}
            >
              Add Time
            </Button>
          </div>

          {/* Quick Presets */}
          <div className="space-y-1 pt-1 border-t border-[#E6ECE8]/70">
            <span className="text-[10px] text-[#7A8782] block font-medium">Quick Presets:</span>
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'Morning (08:00 AM)', time: '08:00' },
                { label: 'Lunch (01:30 PM)', time: '13:30' },
                { label: 'Dinner (07:00 PM)', time: '19:00' },
                { label: 'Bedtime (10:00 PM)', time: '22:00' }
              ].map(preset => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleAddTime(preset.time)}
                  className="px-2 py-1 rounded-lg bg-white border border-[#E6ECE8] text-[10px] text-[#202B28] font-medium hover:border-[#238B78] hover:bg-[#DDEFE8]/30 transition-all cursor-pointer"
                >
                  + {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2 pt-2 border-t border-[#E6ECE8]">
          <Button
            variant="outline"
            fullWidth
            size="md"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            fullWidth
            size="md"
            icon={Check}
            onClick={handleSave}
          >
            Save Timings
          </Button>
        </div>
      </div>
    </Modal>
  );
}
