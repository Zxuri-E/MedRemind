import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  useMedicine, 
  getMedicineStartDate,
  getMedicineTimings,
  getSlotNameForTime,
  isMedicineInSlot,
  isMedicineActiveOnDate
} from '../../context/MedicineContext';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import DosageTimingModal from '../../components/medicines/DosageTimingModal';
import { 
  Check, 
  X, 
  RotateCcw, 
  Clock, 
  CalendarDays, 
  Sun, 
  Sunset, 
  Moon, 
  Coffee, 
  TrendingUp, 
  Plus, 
  Camera, 
  Calendar,
  Edit3
} from 'lucide-react';
import { format, addDays, startOfWeek } from 'date-fns';
import { toast } from 'sonner';

export default function SchedulePage() {
  const navigate = useNavigate();
  const { medicines, updateMedicine, getDoseStatus, recordDose, resetDose } = useMedicine();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [editingTimingMed, setEditingTimingMed] = useState(null);

  const selectedDateStr = format(selectedDate, 'yyyy-MM-dd');
  const todayStr = format(new Date(), 'yyyy-MM-dd');

  // Generate 7 days for the date selector strip
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i));

  const timeSlots = [
    { name: 'Morning', time: '8:00 AM', icon: Coffee },
    { name: 'Afternoon', time: '1:00 PM', icon: Sun },
    { name: 'Evening', time: '7:00 PM', icon: Sunset },
    { name: 'Night', time: '10:00 PM', icon: Moon }
  ];

  const handleTake = (medId, timingString, medName) => {
    recordDose(medId, timingString, 'taken', null, selectedDateStr);
    toast.success(`Dose recorded: ${medName} taken.`);
  };

  const handleSkip = (medId, timingString, medName) => {
    recordDose(medId, timingString, 'skipped', null, selectedDateStr);
    toast.warning(`Dose recorded: ${medName} skipped.`);
  };

  const handleUndo = (medId, timingString, medName) => {
    resetDose(medId, timingString, selectedDateStr);
    toast.info(`Reset dose status for ${medName}.`);
  };

  // Check total active medicines scheduled on this date across all slots
  const activeMedsForDate = medicines.filter(m => isMedicineActiveOnDate(m, selectedDateStr));

  return (
    <div className="p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#202B28]">Daily Medication Schedule</h1>
          <p className="text-xs text-[#7A8782]">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</p>
        </div>
        <button
          onClick={() => navigate('/history')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-[#E6ECE8] text-xs font-semibold text-[#238B78] hover:bg-[#DDEFE8]/40 transition-colors shadow-xs"
        >
          <TrendingUp className="w-3.5 h-3.5" />
          <span>History & PDF</span>
        </button>
      </div>

      {/* Week Day Selector Strip */}
      <div className="flex justify-between items-center bg-white p-2 rounded-2xl border border-[#E6ECE8] shadow-xs">
        {weekDays.map((day) => {
          const isSelected = format(day, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
          const isToday = format(day, 'yyyy-MM-dd') === todayStr;

          return (
            <button
              key={day.toISOString()}
              onClick={() => setSelectedDate(day)}
              className={`flex flex-col items-center py-2 px-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                isSelected
                  ? 'bg-[#238B78] text-white shadow-xs'
                  : 'text-[#7A8782] hover:bg-[#F8FAF8]'
              }`}
            >
              <span className="text-[10px] font-medium opacity-80">{format(day, 'EEE')}</span>
              <span className="text-sm mt-0.5">{format(day, 'd')}</span>
              {isToday && !isSelected && (
                <span className="w-1 h-1 rounded-full bg-[#238B78] mt-1" />
              )}
            </button>
          );
        })}
      </div>

      {/* Time-based Medication Slots */}
      <div className="space-y-4">
        {timeSlots.map((slot) => {
          const SlotIcon = slot.icon;
          
          // Robust filter: matches medicines scheduled for this date and time window
          const slotMeds = medicines.filter(m => {
            return isMedicineActiveOnDate(m, selectedDateStr) && isMedicineInSlot(m, slot.name);
          });

          return (
            <div key={slot.name} className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-[#7A8782] uppercase tracking-wider px-1">
                <span className="flex items-center gap-1.5 text-[#202B28]">
                  <SlotIcon className="w-4 h-4 text-[#238B78]" />
                  {slot.name} ({slot.time})
                </span>
                <span>{slotMeds.length} meds</span>
              </div>

              {slotMeds.length === 0 ? (
                <div className="p-3 bg-white/60 rounded-xl border border-dashed border-[#E6ECE8] text-center text-xs text-[#7A8782]">
                  No medications scheduled for {slot.name.toLowerCase()}.
                </div>
              ) : (
                slotMeds.map((med) => {
                  const timings = getMedicineTimings(med);
                  const matchedTiming = timings.find(t => getSlotNameForTime(t)?.toLowerCase() === slot.name.toLowerCase()) || timings[0] || `${slot.name} (${slot.time})`;
                  const fullSlotString = `${slot.name} (${slot.time})`;

                  // Comprehensive status lookup across all possible recorded key aliases
                  const doseStatus = getDoseStatus(med.id, matchedTiming, selectedDateStr) ||
                                     getDoseStatus(med.id, fullSlotString, selectedDateStr) ||
                                     getDoseStatus(med.id, slot.name, selectedDateStr) ||
                                     getDoseStatus(med.id, med.timeSlots?.[0], selectedDateStr);

                  const isTaken = doseStatus?.status === 'taken';
                  const isSkipped = doseStatus?.status === 'skipped';
                  const isPending = !isTaken && !isSkipped;

                  return (
                    <Card key={med.id} className="p-3.5 space-y-3 bg-white">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-sm text-[#202B28]">{med.name}</h3>
                            <span className="text-xs text-[#7A8782]">{med.dosage}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <button
                              type="button"
                              onClick={() => setEditingTimingMed(med)}
                              title="Click to edit dosage timings"
                              className="inline-flex items-center gap-1 text-[11px] font-medium text-[#238B78] bg-[#DDEFE8]/60 hover:bg-[#DDEFE8] px-2 py-0.5 rounded-md transition-colors cursor-pointer border border-[#238B78]/20"
                            >
                              <Clock className="w-3 h-3 text-[#238B78]" />
                              <span>{matchedTiming}</span>
                              <Edit3 className="w-2.5 h-2.5 text-[#238B78] ml-0.5 opacity-70" />
                            </button>
                            {med.form && (
                              <span className="text-[11px] text-[#7A8782]">
                                {med.form}
                              </span>
                            )}
                          </div>
                          {med.instructions && (
                            <p className="text-[11px] text-[#7A8782] mt-1.5 italic">
                              {String(med.instructions).replace(/^undefined\.?\s*/i, '').replace(/\bundefined\b/gi, '').trim() || 'Take as directed by doctor.'}
                            </p>
                          )}
                        </div>

                        {/* Status Badge */}
                        {isTaken && <Badge variant="success" icon={Check}>Taken at {doseStatus.timestamp}</Badge>}
                        {isSkipped && <Badge variant="danger" icon={X}>Skipped</Badge>}
                        {isPending && <Badge variant="warning">Pending</Badge>}
                      </div>

                      {/* Interactive Dose Actions */}
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E6ECE8]">
                        <button
                          type="button"
                          onClick={() => setEditingTimingMed(med)}
                          className="text-[11px] font-semibold text-[#7A8782] hover:text-[#238B78] flex items-center gap-1 cursor-pointer py-1 px-1 rounded transition-colors"
                          title="Edit dose timings and alarms"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Edit Timing</span>
                        </button>
                        <div className="flex items-center gap-2">
                          {isPending && (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                icon={X}
                                onClick={() => handleSkip(med.id, matchedTiming, med.name)}
                              >
                                Skip
                              </Button>
                              <Button
                                variant="primary"
                                size="sm"
                                icon={Check}
                                onClick={() => handleTake(med.id, matchedTiming, med.name)}
                              >
                                Take Dose
                              </Button>
                            </>
                          )}

                          {!isPending && (
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={RotateCcw}
                              onClick={() => handleUndo(med.id, matchedTiming, med.name)}
                            >
                              Undo
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  );
                })
              )}
            </div>
          );
        })}
      </div>

      {/* Empty State Banner if no medications are active at all for selected date */}
      {activeMedsForDate.length === 0 && (
        <Card className="p-5 text-center bg-white space-y-3 border border-[#E6ECE8] shadow-xs">
          <Calendar className="w-10 h-10 text-[#238B78] mx-auto opacity-80" />
          <div>
            <h3 className="font-bold text-sm text-[#202B28]">No active medications for this date</h3>
            <p className="text-xs text-[#7A8782] mt-1 max-w-sm mx-auto">
              {medicines.filter(m => m.status === 'Active').length === 0 
                ? 'You have not added any medicines to your routine yet.' 
                : `Your active medications are not scheduled for ${format(selectedDate, 'MMM d, yyyy')}.`}
            </p>
          </div>
          <div className="flex items-center justify-center gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              icon={Plus}
              onClick={() => navigate('/medicines/add')}
            >
              Add Medicine
            </Button>
            <Button
              variant="primary"
              size="sm"
              icon={Camera}
              onClick={() => navigate('/scanner')}
            >
              Scan Prescription
            </Button>
          </div>
        </Card>
      )}
      {/* Edit Dosage Timing Modal */}
      {editingTimingMed && (
        <DosageTimingModal
          isOpen={!!editingTimingMed}
          onClose={() => setEditingTimingMed(null)}
          medicine={editingTimingMed}
          onSave={(updated) => updateMedicine(editingTimingMed.id, updated)}
        />
      )}
    </div>
  );
}
