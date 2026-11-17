import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMedicine } from '../../context/MedicineContext';
import Card from '../../components/common/Card';
import Button from '../../components/common/Button';
import Badge from '../../components/common/Badge';
import Modal from '../../components/common/Modal';
import DosageTimingModal from '../../components/medicines/DosageTimingModal';
import { ArrowLeft, Clock, Calendar, FileText, UserCheck, Trash2, Edit3, Power } from 'lucide-react';
import { toast } from 'sonner';

export default function MedicineDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { medicines, updateMedicine, deleteMedicine, toggleMedicineActive } = useMedicine();
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTimingModal, setShowTimingModal] = useState(false);

  const medicine = medicines.find(m => m.id === id);

  if (!medicine) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-sm text-[#7A8782]">Medicine record not found.</p>
        <Button onClick={() => navigate('/medicines')}>Return to Medicines</Button>
      </div>
    );
  }

  const handleDelete = () => {
    deleteMedicine(medicine.id);
    toast.success(`${medicine.name} removed from your routine.`);
    navigate('/medicines');
  };

  return (
    <div className="p-4 space-y-4">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#E6ECE8]">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#7A8782] hover:text-[#202B28] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            icon={Edit3}
            onClick={() => navigate(`/medicines/edit/${medicine.id}`)}
          >
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={Trash2}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
            onClick={() => setShowDeleteModal(true)}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* Hero Card */}
      <Card className="bg-white border-[#E6ECE8]">
        <div className="flex items-start justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#238B78]">
              {medicine.form || 'Prescription Medicine'}
            </span>
            <h1 className="text-2xl font-bold text-[#202B28] mt-0.5">{medicine.name}</h1>
            <p className="text-sm font-medium text-[#7A8782]">{medicine.dosage}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Badge variant={medicine.status === 'Active' ? 'success' : 'neutral'}>
              {medicine.status || 'Active'}
            </Badge>
            <button
              type="button"
              onClick={() => {
                toggleMedicineActive(medicine.id);
                toast.success(`${medicine.name} marked ${medicine.status === 'Active' ? 'Inactive' : 'Active'}.`);
              }}
              className="text-[11px] font-semibold text-[#238B78] hover:underline flex items-center gap-1 cursor-pointer"
            >
              <Power className="w-3 h-3" />
              {medicine.status === 'Active' ? 'Pause Routine' : 'Reactivate'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-[#E6ECE8] text-xs">
          <div>
            <span className="text-[#7A8782] block text-[10px] uppercase font-semibold">Frequency</span>
            <span className="font-semibold text-[#202B28]">{medicine.frequency}</span>
          </div>
          <div>
            <span className="text-[#7A8782] block text-[10px] uppercase font-semibold">Refills Left</span>
            <span className="font-semibold text-[#202B28]">{medicine.refillsRemaining ?? 'N/A'}</span>
          </div>
        </div>
      </Card>

      {/* Routine Timings */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-sm text-[#202B28] flex items-center gap-2">
            <Clock className="w-4 h-4 text-[#238B78]" /> Scheduled Dose Times
          </h3>
          <button
            type="button"
            onClick={() => setShowTimingModal(true)}
            className="text-xs font-semibold text-[#238B78] hover:text-[#1b6d5e] flex items-center gap-1 cursor-pointer bg-[#DDEFE8]/40 hover:bg-[#DDEFE8] px-2.5 py-1 rounded-lg transition-colors border border-[#238B78]/20"
          >
            <Edit3 className="w-3.5 h-3.5" /> Edit Timings
          </button>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          {(medicine.timeSlots || ['Morning (8:00 AM)']).map((slot, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setShowTimingModal(true)}
              title="Click to edit dosage timings"
              className="px-3 py-1.5 rounded-xl bg-[#DDEFE8] hover:bg-[#cde8df] text-[#1b6d5e] font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-[#238B78]/20"
            >
              <Clock className="w-3 h-3 text-[#238B78]" />
              <span>{slot}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-[#7A8782] pt-1 border-t border-[#E6ECE8]/60">
          Tip: Tap any timing or &quot;Edit Timings&quot; to change dose hours, add alarms, or customize frequency.
        </p>
      </Card>

      {/* Instructions & Clinical Notes */}
      <Card className="space-y-2">
        <h3 className="font-bold text-sm text-[#202B28] flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#238B78]" /> Patient Instructions
        </h3>
        <p className="text-xs text-[#202B28] leading-relaxed bg-[#F8FAF8] p-3 rounded-xl border border-[#E6ECE8]">
          {String(medicine.instructions || 'Take as prescribed by your doctor.').replace(/^undefined\.?\s*/i, '').replace(/\bundefined\b/gi, '').trim() || 'Take as prescribed by your doctor.'}
        </p>
      </Card>

      {/* Prescribing Physician */}
      <Card className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-[#DDEFE8] flex items-center justify-center text-[#238B78]">
          <UserCheck className="w-5 h-5" />
        </div>
        <div className="text-xs">
          <span className="text-[#7A8782] block text-[10px] uppercase font-semibold">Prescribed By</span>
          <span className="font-bold text-[#202B28]">{medicine.prescribedBy || 'Licensed Practitioner'}</span>
          <span className="text-[11px] text-[#7A8782] block">Started on {medicine.startDate || 'October 2026'}</span>
        </div>
      </Card>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Remove Medicine"
      >
        <div className="space-y-4">
          <p className="text-xs text-[#7A8782] leading-relaxed">
            Are you sure you want to remove <strong className="text-[#202B28]">{medicine.name} {medicine.dosage}</strong> from your routine? Past dose history will be preserved.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              fullWidth
              onClick={() => setShowDeleteModal(false)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              fullWidth
              onClick={handleDelete}
            >
              Confirm Remove
            </Button>
          </div>
        </div>
      </Modal>
      {/* Edit Dosage Timing Modal */}
      <DosageTimingModal
        isOpen={showTimingModal}
        onClose={() => setShowTimingModal(false)}
        medicine={medicine}
        onSave={(updated) => updateMedicine(medicine.id, updated)}
      />
    </div>
  );
}
