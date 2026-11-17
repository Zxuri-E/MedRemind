import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMedicine } from '../../context/MedicineContext';
import { useAuth } from '../../context/AuthContext';
import { capturePrescriptionImage } from '../../services/cameraService';
import { 
  scanPrescriptionsBatch, 
  approvePrescriptionsBatch,
  getEngineStatus 
} from '../../services/prescriptionBackendService';
import { runClientOfflineOcr } from '../../services/clientOcrService';
import { processPdfDocument } from '../../services/pdfService';
import { checkDrugAllergyConflict } from '../../utils/drugKnowledgeBase';
import { getUserDisplayName } from '../../utils/greetingUtils';
import Button from '../../components/common/Button';
import Card from '../../components/common/Card';
import Badge from '../../components/common/Badge';
import { 
  Camera, 
  Upload, 
  Sparkles, 
  CheckCircle2, 
  ArrowLeft,
  FileText,
  Stethoscope,
  Trash2,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Files,
  UserCheck,
  UserX,
  Wifi,
  WifiOff,
  Pill,
  ShieldAlert,
  Edit3,
  AlertTriangle,
  Calendar,
  Building2,
  Tag
} from 'lucide-react';
import { toast } from 'sonner';

export default function ScannerPage() {
  const navigate = useNavigate();
  const { approvePrescription, patientProfile } = useMedicine();
  const { currentUser } = useAuth();

  const registeredPatientName = getUserDisplayName(currentUser);
  const registeredPatientId = currentUser?.id || 'USR-patient';

  // Selection & Mode State
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [scanMode, setScanMode] = useState('online'); // 'online' | 'offline'
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgressText, setScanProgressText] = useState('');
  const [engineStatus, setEngineStatus] = useState(null);
  const [batchResult, setBatchResult] = useState(null);
  const [masterConfirmed, setMasterConfirmed] = useState(false);
  const [mismatchAcknowledgements, setMismatchAcknowledgements] = useState({});
  const [docPatientNames, setDocPatientNames] = useState({});

  // File Inputs
  const storageInputRef = useRef(null);
  const replaceInputRef = useRef(null);
  const [replacingIndex, setReplacingIndex] = useState(null);

  // Fetch Engine Capabilities
  useEffect(() => {
    getEngineStatus().then(status => setEngineStatus(status)).catch(() => {});
  }, []);

  // Compute SHA-256 hash in browser
  const computeHash = async (arrayBuffer) => {
    try {
      const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      return `hash-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    }
  };

  // Process & Validate Selected Storage Files
  const processStorageFiles = async (fileList) => {
    const validExtensions = ['jpg', 'jpeg', 'png', 'pdf'];
    const newItems = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const ext = file.name.split('.').pop().toLowerCase();

      if (!validExtensions.includes(ext)) {
        toast.error(`Unsupported format: "${file.name}". Please upload PDF, JPG, or PNG files.`);
        continue;
      }

      if (file.size > 25 * 1024 * 1024) {
        toast.error(`File "${file.name}" exceeds 25MB limit.`);
        continue;
      }

      try {
        const arrayBuffer = await file.arrayBuffer();
        const sha256 = await computeHash(arrayBuffer);

        const isDuplicate = selectedFiles.some(f => f.sha256 === sha256) || newItems.some(f => f.sha256 === sha256);
        if (isDuplicate) {
          toast.warning(`Duplicate document skipped: "${file.name}" is already selected.`);
          continue;
        }

        let previewUrl = null;
        let isPdf = ext === 'pdf';

        if (isPdf) {
          // Render page 1 preview using PDF.js
          try {
            const pdfData = await processPdfDocument(arrayBuffer, 1.0);
            previewUrl = pdfData.pages[0]?.dataUrl || null;
          } catch (e) {
            console.warn('PDF preview render error:', e);
          }
        }

        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        newItems.push({
          id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          name: file.name,
          type: isPdf ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          format: ext.toUpperCase(),
          size: file.size,
          dataUrl,
          previewUrl: previewUrl || dataUrl,
          sha256,
          isPdf,
          source: 'storage'
        });
      } catch (err) {
        console.error('File read error:', err);
        toast.error(`Failed to read "${file.name}".`);
      }
    }

    if (newItems.length > 0) {
      setSelectedFiles(prev => [...prev, ...newItems]);
      toast.success(`Added ${newItems.length} document(s) from storage.`);
    }
  };

  // Camera Capture Handler (Multi-capture supported)
  const handleCameraCapture = async () => {
    try {
      const result = await capturePrescriptionImage('camera');
      if (result.success && result.dataUrl) {
        const res = await fetch(result.dataUrl);
        const blob = await res.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const sha256 = await computeHash(arrayBuffer);

        const pageNum = selectedFiles.filter(f => f.source === 'camera').length + 1;
        const newDoc = {
          id: `cam-${Date.now()}`,
          name: `Prescription_Photo_Page_${pageNum}.jpg`,
          type: 'image/jpeg',
          format: 'JPG',
          size: blob.size,
          dataUrl: result.dataUrl,
          previewUrl: result.dataUrl,
          sha256,
          isPdf: false,
          source: 'camera'
        };

        setSelectedFiles(prev => [...prev, newDoc]);
        toast.success(`Photo captured (Page ${pageNum}). You can capture additional pages or submit.`);
      } else if (result.error && result.error !== 'Cancelled') {
        toast.error(result.error);
      }
    } catch (e) {
      console.error(e);
      toast.error('Camera capture failed.');
    }
  };

  // Replace / Retake a specific image
  const handleRetakeCamera = async (index) => {
    try {
      const result = await capturePrescriptionImage('camera');
      if (result.success && result.dataUrl) {
        const res = await fetch(result.dataUrl);
        const blob = await res.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const sha256 = await computeHash(arrayBuffer);

        setSelectedFiles(prev => {
          const updated = [...prev];
          updated[index] = {
            ...updated[index],
            dataUrl: result.dataUrl,
            previewUrl: result.dataUrl,
            size: blob.size,
            sha256
          };
          return updated;
        });
        toast.success(`Page ${index + 1} retaken.`);
      }
    } catch (e) {
      toast.error('Retake failed.');
    }
  };

  const handleReplaceFromStorage = (index) => {
    setReplacingIndex(index);
    replaceInputRef.current?.click();
  };

  const handleReplaceSelected = async (e) => {
    if (e.target.files && e.target.files.length > 0 && replacingIndex !== null) {
      const file = e.target.files[0];
      const ext = file.name.split('.').pop().toLowerCase();
      const validExtensions = ['jpg', 'jpeg', 'png', 'pdf'];

      if (!validExtensions.includes(ext)) {
        toast.error('Unsupported format. Please select PDF, JPG, or PNG.');
        return;
      }

      const arrayBuffer = await file.arrayBuffer();
      const sha256 = await computeHash(arrayBuffer);
      const isPdf = ext === 'pdf';

      let previewUrl = null;
      if (isPdf) {
        try {
          const pdfData = await processPdfDocument(arrayBuffer, 1.0);
          previewUrl = pdfData.pages[0]?.dataUrl || null;
        } catch (_err) {
          // Preview generation fallback
        }
      }

      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(file);
      });

      setSelectedFiles(prev => {
        const updated = [...prev];
        updated[replacingIndex] = {
          id: `file-${Date.now()}`,
          name: file.name,
          type: isPdf ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`,
          format: ext.toUpperCase(),
          size: file.size,
          dataUrl,
          previewUrl: previewUrl || dataUrl,
          sha256,
          isPdf,
          source: 'storage'
        };
        return updated;
      });

      toast.success(`Replaced with "${file.name}".`);
      setReplacingIndex(null);
    }
    e.target.value = null;
  };

  const moveFile = (fromIndex, toIndex) => {
    if (toIndex < 0 || toIndex >= selectedFiles.length) return;
    setSelectedFiles(prev => {
      const copy = [...prev];
      const [moved] = copy.splice(fromIndex, 1);
      copy.splice(toIndex, 0, moved);
      return copy;
    });
  };

  const removeFile = (index) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    toast.info('Document removed from selection.');
  };

  // Submit Prescription Analysis
  const handleAnalyzePrescriptions = async () => {
    if (selectedFiles.length === 0) {
      toast.error('Please capture or select at least one prescription document.');
      return;
    }

    setIsScanning(true);
    setScanProgressText('Preparing documents for analysis...');

    try {
      if (scanMode === 'online') {
        // --- 1. Cloud Multimodal Gemini Processing ---
        setScanProgressText('Transmitting documents to Gemini AI engine...');

        const payloadFiles = selectedFiles.map(f => ({
          name: f.name,
          type: f.type,
          dataUrl: f.dataUrl,
          size: f.size,
          sha256: f.sha256
        }));

        const result = await scanPrescriptionsBatch({
          files: payloadFiles,
          patientId: registeredPatientId,
          mode: 'online'
        });

        setIsScanning(false);
        setBatchResult(result);
        const initialNames = {};
        (result.documents || []).forEach(d => {
          const det = d.evidence?.patientNameText || d.patientName;
          initialNames[d.documentId] = (det && det !== 'None detected') ? det : registeredPatientName;
        });
        setDocPatientNames(initialNames);
        toast.success(`Analysis completed. ${result.documents.length} document(s) verified.`);
      } else {
        // --- 2. Genuine Client-Side Offline Tesseract OCR ---
        const result = await runClientOfflineOcr({
          files: selectedFiles,
          patientName: registeredPatientName,
          onProgress: (status) => setScanProgressText(status)
        });

        setIsScanning(false);
        setBatchResult(result);
        const initialNames = {};
        (result.documents || []).forEach(d => {
          const det = d.evidence?.patientNameText || d.patientName;
          initialNames[d.documentId] = (det && det !== 'None detected') ? det : registeredPatientName;
        });
        setDocPatientNames(initialNames);
        toast.success(`Offline OCR completed: ${result.documents.length} document(s) processed.`);
      }
    } catch (err) {
      setIsScanning(false);
      console.error('Scan analysis error:', err);
      toast.error('Prescription processing failed: ' + (err.message || 'Please check your connection and try again.'));
    }
  };

  // Toggle Mismatch Acknowledgement
  const toggleMismatchAck = (documentId) => {
    setMismatchAcknowledgements(prev => ({
      ...prev,
      [documentId]: !prev[documentId]
    }));
  };

  // Final Explicit Approval
  const handleApproveBatch = async () => {
    if (!batchResult) return;

    const unacknowledgedMismatches = batchResult.documents.filter(
      d => d.patientVerification?.status === 'MISMATCH' && !mismatchAcknowledgements[d.documentId]
    );

    if (unacknowledgedMismatches.length > 0) {
      toast.error('Please acknowledge the patient name mismatch or discard the mismatched document.');
      return;
    }

    if (!masterConfirmed) {
      toast.error('Please check the confirmation box acknowledging you verified medication instructions.');
      return;
    }

    try {
      const payloadDocuments = batchResult.documents.map(doc => ({
        documentId: doc.documentId,
        fileName: doc.fileName,
        patientVerification: doc.patientVerification,
        mismatchAcknowledged: !!mismatchAcknowledgements[doc.documentId],
        approvedMedicines: doc.medicines
      }));

      // If online, record on server
      if (scanMode === 'online') {
        await approvePrescriptionsBatch({
          batchId: batchResult.batchId,
          patientId: registeredPatientId,
          documents: payloadDocuments
        }).catch(err => {
          console.warn('Backend approval record skipped in offline/fallback mode:', err.message);
        });
      }

      // Add to local schedule & activate offline reminders
      batchResult.documents.forEach(doc => {
        (doc.medicines || []).forEach(med => {
          approvePrescription({
            medicineName: med.brandName || med.name || med.rawRecognizedName || 'Prescribed Medicine',
            brandName: med.brandName,
            genericIngredient: med.genericIngredient,
            dosage: med.dosage || '1 Tablet',
            strength: med.strength || 'As Prescribed',
            form: med.form || 'Tablet',
            morningDose: med.morningDose ?? 1,
            afternoonDose: med.afternoonDose ?? 0,
            nightDose: med.nightDose ?? 0,
            frequency: med.frequency || 'Once daily',
            timeSlots: med.timeSlots || ["Morning (8:00 AM)"],
            times: med.times || ["08:00"],
            instructions: med.instructions || 'Take as directed',
            prescribedBy: doc.evidence?.doctorName || 'Licensed Physician',
            duration: med.duration || '7 days',
            refills: 0
          });
        });
      });

      toast.success('Prescription approved! Medication schedules active.');
      navigate('/medicines');
    } catch (err) {
      console.error('Batch approval failed:', err);
      toast.error('Failed to submit approval: ' + err.message);
    }
  };

  const handleDiscardBatch = () => {
    setSelectedFiles([]);
    setBatchResult(null);
    setMasterConfirmed(false);
    setMismatchAcknowledgements({});
    toast.info('Prescription batch discarded.');
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 max-w-xl mx-auto w-full">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-2 border-b border-[#E6ECE8]">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 text-xs font-semibold text-[#7A8782] hover:text-[#202B28] cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-1 text-xs font-bold text-[#238B78] uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" /> Prescription Verification
        </div>
      </div>

      {/* Hidden File Inputs */}
      <input 
        type="file" 
        ref={storageInputRef} 
        multiple 
        accept="image/jpeg,image/png,image/jpg,application/pdf" 
        className="hidden" 
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            processStorageFiles(Array.from(e.target.files));
          }
          e.target.value = null;
        }} 
      />
      <input 
        type="file" 
        ref={replaceInputRef} 
        accept="image/jpeg,image/png,image/jpg,application/pdf" 
        className="hidden" 
        onChange={handleReplaceSelected} 
      />
      {/* STAGE 1: Engine Selection & Document Upload Options                        */}
      {/* ========================================================================= */}
      {!batchResult && (
        <div className="space-y-4">
          
          {/* Recognition Engine Selector (Clean, Non-overlapping Layout) */}
          <div className="p-3.5 rounded-2xl bg-white border border-[#E6ECE8] shadow-xs space-y-2.5">
            <span className="text-[11px] font-bold text-[#7A8782] uppercase tracking-wider block">
              Recognition Engine:
            </span>

            <div className="space-y-2">
              {/* Option A: Gemini AI (Recommended) */}
              <button
                type="button"
                onClick={() => setScanMode('online')}
                className={`w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                  scanMode === 'online'
                    ? 'border-[#238B78] bg-[#DDEFE8]/25 ring-1.5 ring-[#238B78]'
                    : 'border-[#E6ECE8] bg-white hover:border-[#238B78]/40'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-[#238B78]" />
                    <span className="text-sm font-bold text-[#202B28]">Gemini AI</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#238B78] text-white">
                    Recommended
                  </span>
                </div>
                <p className="text-xs text-[#7A8782] leading-snug">
                  Multimodal clinical AI for handwritten prescriptions & shorthand notation.
                </p>
                <span className="text-[10px] font-semibold text-[#238B78] mt-1.5 block">
                  ● Requires internet connectivity
                </span>
              </button>

              {/* Option B: Offline OCR */}
              <button
                type="button"
                onClick={() => setScanMode('offline')}
                className={`w-full p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                  scanMode === 'offline'
                    ? 'border-[#238B78] bg-[#DDEFE8]/25 ring-1.5 ring-[#238B78]'
                    : 'border-[#E6ECE8] bg-white hover:border-[#238B78]/40'
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <WifiOff className="w-4 h-4 text-gray-600" />
                    <span className="text-sm font-bold text-[#202B28]">Offline OCR</span>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gray-200 text-gray-700">
                    On-Device
                  </span>
                </div>
                <p className="text-xs text-[#7A8782] leading-snug">
                  Local optical character recognition engine. Runs 100% on device without internet.
                </p>
                <span className="text-[10px] font-semibold text-gray-600 mt-1.5 block">
                  ● Works without internet or dev server
                </span>
              </button>
            </div>
          </div>

          {/* TWO PRIMARY OPTIONS: Camera & Storage */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-bold text-[#7A8782] uppercase tracking-wider block px-0.5">
              Select Capture Source:
            </span>
            <div className="grid grid-cols-2 gap-3">
              {/* Option 1: Camera */}
              <button
                type="button"
                onClick={handleCameraCapture}
                className="flex flex-col items-center justify-center p-5 rounded-2xl bg-white border-2 border-dashed border-[#238B78]/50 hover:border-[#238B78] hover:bg-[#DDEFE8]/20 transition-all cursor-pointer group shadow-xs text-center active:scale-[0.98]"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#DDEFE8] flex items-center justify-center text-[#238B78] mb-2 group-hover:scale-105 transition-transform shadow-xs">
                  <Camera className="w-6 h-6" />
                </div>
                <span className="text-sm font-bold text-[#202B28] block">Camera</span>
                <span className="text-[11px] text-[#7A8782] mt-0.5">Take Photos</span>
                <span className="text-[10px] text-[#238B78] font-medium mt-1">Multi-page support</span>
              </button>

              {/* Option 2: Storage */}
              <button
                type="button"
                onClick={() => storageInputRef.current?.click()}
                className="flex flex-col items-center justify-center p-5 rounded-2xl bg-white border-2 border-dashed border-[#E6ECE8] hover:border-[#238B78] hover:bg-[#DDEFE8]/20 transition-all cursor-pointer group shadow-xs text-center active:scale-[0.98]"
              >
                <div className="w-12 h-12 rounded-2xl bg-[#F8FAF8] border border-[#E6ECE8] flex items-center justify-center text-[#238B78] mb-2 group-hover:scale-105 transition-transform shadow-xs">
                  <Upload className="w-6 h-6" />
                </div>
                <span className="text-sm font-bold text-[#202B28] block">Storage</span>
                <span className="text-[11px] text-[#7A8782] mt-0.5">Files & Images</span>
                <span className="text-[10px] text-[#7A8782] font-medium mt-1">PDF, JPG, PNG</span>
              </button>
            </div>
          </div>

          {/* Selected Document Tray & Previews */}
          {selectedFiles.length > 0 && (
            <div className="space-y-2.5 pt-1">
              <div className="flex items-center justify-between px-0.5">
                <span className="text-xs font-bold text-[#202B28] flex items-center gap-1.5">
                  <Files className="w-4 h-4 text-[#238B78]" />
                  Selected Documents ({selectedFiles.length})
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedFiles([])}
                  className="text-xs text-red-600 hover:underline cursor-pointer"
                >
                  Clear All
                </button>
              </div>

              <div className="space-y-2">
                {selectedFiles.map((doc, index) => (
                  <Card key={doc.id} className="p-3 bg-white flex items-center gap-3">
                    {/* Thumbnail Preview */}
                    <div className="w-14 h-14 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {doc.isPdf ? (
                        doc.previewUrl && doc.previewUrl.startsWith('data:image') ? (
                          <img src={doc.previewUrl} alt={doc.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="text-center p-1">
                            <FileText className="w-5 h-5 text-rose-600 mx-auto" />
                            <span className="text-[9px] font-bold text-rose-600">PDF</span>
                          </div>
                        )
                      ) : (
                        <img src={doc.dataUrl} alt={doc.name} className="w-full h-full object-cover" />
                      )}
                    </div>

                    {/* Metadata & Label */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-[#202B28] truncate">{doc.name}</span>
                        <Badge variant="neutral" size="sm">{doc.format}</Badge>
                      </div>
                      <p className="text-[11px] text-[#7A8782] mt-0.5">
                        {(doc.size / 1024).toFixed(0)} KB • Page {index + 1}
                      </p>
                      <div className="flex items-center gap-2 mt-1">
                        <button
                          type="button"
                          onClick={() => doc.source === 'camera' ? handleRetakeCamera(index) : handleReplaceFromStorage(index)}
                          className="text-[11px] font-semibold text-[#238B78] hover:underline cursor-pointer flex items-center gap-0.5"
                        >
                          <RefreshCw className="w-3 h-3" /> Retake
                        </button>
                        <span className="text-[#E6ECE8]">•</span>
                        <button
                          type="button"
                          onClick={() => removeFile(index)}
                          className="text-[11px] font-semibold text-red-600 hover:underline cursor-pointer flex items-center gap-0.5"
                        >
                          <Trash2 className="w-3 h-3" /> Remove
                        </button>
                      </div>
                    </div>

                    {/* Order Controls */}
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveFile(index, index - 1)}
                        className={`p-1 rounded text-gray-500 hover:bg-gray-100 ${index === 0 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={index === selectedFiles.length - 1}
                        onClick={() => moveFile(index, index + 1)}
                        className={`p-1 rounded text-gray-500 hover:bg-gray-100 ${index === selectedFiles.length - 1 ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}`}
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </Card>
                ))}
              </div>

              {/* Multi-page Addition Pill */}
              <div className="flex items-center gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  fullWidth
                  icon={Camera}
                  onClick={handleCameraCapture}
                >
                  + Add Camera Photo
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  fullWidth
                  icon={Upload}
                  onClick={() => storageInputRef.current?.click()}
                >
                  + Add from Storage
                </Button>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <Button
                  fullWidth
                  size="lg"
                  disabled={isScanning}
                  onClick={handleAnalyzePrescriptions}
                  className="shadow-md"
                >
                  {isScanning 
                    ? (scanProgressText || 'Processing...') 
                    : `Analyze with ${scanMode === 'online' ? 'Gemini AI' : 'Offline OCR'} (${selectedFiles.length})`
                  }
                </Button>
              </div>
            </div>
          )}

          {/* Loading Indicator */}
          {isScanning && (
            <Card className="p-6 text-center space-y-3 bg-[#DDEFE8]/30 border-[#238B78]/30">
              <RefreshCw className="w-8 h-8 text-[#238B78] animate-spin mx-auto" />
              <h4 className="font-bold text-sm text-[#202B28]">Processing Prescriptions</h4>
              <p className="text-xs text-[#1b6d5e]">{scanProgressText}</p>
            </Card>
          )}
        </div>
      )}

      {/* ========================================================================= */}
      {/* STAGE 2: Verification, Medical Review & Approval Flow                     */}
      {/* ========================================================================= */}
      {batchResult && (
        <div className="space-y-4">
          <div className="p-3.5 rounded-2xl bg-white border border-[#E6ECE8] flex items-center justify-between">
            <div>
              <span className="text-xs font-bold text-[#202B28] block">Reviewing Prescription Documents</span>
              <span className="text-[11px] text-[#7A8782]">
                {batchResult.documents.length} document(s) • Processed via {batchResult.engine || 'Vision Engine'}
              </span>
            </div>
            <Badge variant="primary" icon={CheckCircle2}>Verified</Badge>
          </div>

          {/* Documents Review List */}
          <div className="space-y-3">
            {batchResult.documents.map((doc, docIdx) => {
              const isMismatch = doc.patientVerification?.status === 'MISMATCH';
              const isAcked = !!mismatchAcknowledgements[doc.documentId];

              return (
                <Card key={doc.documentId || docIdx} className="p-4 space-y-3 bg-white">
                  {/* Document Header */}
                  <div className="flex items-start justify-between pb-2 border-b border-[#E6ECE8]">
                    <div className="flex items-center gap-2.5">
                      <div className="w-10 h-10 rounded-xl bg-[#DDEFE8] flex items-center justify-center text-[#238B78]">
                        <FileText className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-bold text-sm text-[#202B28]">{doc.fileName}</h4>
                        <p className="text-[11px] text-[#7A8782]">{doc.documentClassification || 'PRESCRIPTION'}</p>
                      </div>
                    </div>
                    <Badge variant={doc.qualityStatus === 'OPTIMAL' ? 'success' : 'neutral'} size="sm">
                      {doc.qualityStatus || 'Optimal'}
                    </Badge>
                  </div>

                  {/* Patient Name Verification Status */}
                  <div className={`p-3.5 rounded-xl border text-xs space-y-2.5 ${
                    isMismatch 
                      ? 'bg-amber-50/70 border-amber-200 text-amber-900' 
                      : 'bg-emerald-50/60 border-emerald-100 text-emerald-900'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold flex items-center gap-1.5">
                        {isMismatch ? <UserX className="w-4 h-4 text-amber-600" /> : <UserCheck className="w-4 h-4 text-emerald-600" />}
                        {doc.patientVerification?.displayTitle || 'Patient Name Verification'}
                      </span>
                      <span className="text-[10px] uppercase font-bold tracking-wider">
                        {doc.patientVerification?.status || 'VERIFIED'}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] bg-white/70 p-2.5 rounded-lg border border-current/10">
                      <div>
                        <span className="text-[#7A8782] block text-[10px] uppercase font-semibold">Account Holder</span>
                        <strong className="text-[#202B28]">{registeredPatientName}</strong>
                      </div>
                      <div>
                        <span className="text-[#7A8782] block text-[10px] uppercase font-semibold">Extracted from Doc</span>
                        <strong className="text-[#202B28]">{doc.evidence?.patientNameText || 'None detected'}</strong>
                      </div>
                    </div>

                    {/* Editable Patient Name Input Field */}
                    <div className="space-y-1 pt-1">
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[#202B28] flex items-center gap-1">
                        <Edit3 className="w-3 h-3 text-[#238B78]" /> Confirm or Edit Prescription Patient Name:
                      </label>
                      <input
                        type="text"
                        value={docPatientNames[doc.documentId] ?? registeredPatientName}
                        onChange={(e) => setDocPatientNames(prev => ({ ...prev, [doc.documentId]: e.target.value }))}
                        placeholder="Patient name on prescription"
                        className="w-full px-3 py-1.5 rounded-lg bg-white border border-[#E6ECE8] text-xs font-semibold text-[#202B28] focus:outline-none focus:border-[#238B78]"
                      />
                      <p className="text-[10px] text-[#7A8782]">
                        This preserves the patient name on this prescription without altering your account profile.
                      </p>
                    </div>

                    {/* Mismatch Explicit Acknowledgement */}
                    {isMismatch && (
                      <label className="flex items-center gap-2 pt-1.5 border-t border-amber-200 font-semibold cursor-pointer text-amber-950">
                        <input
                          type="checkbox"
                          checked={isAcked}
                          onChange={() => toggleMismatchAck(doc.documentId)}
                          className="accent-amber-600 w-4 h-4 rounded"
                        />
                        <span>I confirm this prescription is for me despite the name variance.</span>
                      </label>
                    )}
                  </div>

                  {/* Doctor & Clinic Evidence */}
                  {doc.evidence && (
                    <div className="text-[11px] text-[#7A8782] flex items-center justify-between px-1">
                      <span className="flex items-center gap-1">
                        <Stethoscope className="w-3.5 h-3.5 text-[#238B78]" />
                        {doc.evidence.doctorName || 'Licensed Physician'}
                      </span>
                      <span>Date: {doc.evidence.date || 'Current'}</span>
                    </div>
                  )}

                  {/* Extracted Medicines */}
                  <div className="space-y-2 pt-1">
                    <span className="text-xs font-bold text-[#202B28] block">
                      Extracted Medicines ({(doc.medicines || []).length}):
                    </span>

                    {(doc.medicines || []).length === 0 ? (
                      <div className="p-3 bg-gray-50 rounded-xl text-center text-xs text-[#7A8782]">
                        No individual medication records identified in this document.
                      </div>
                    ) : (
                      doc.medicines.map((med, medIdx) => {
                        const allergyConflict = checkDrugAllergyConflict(
                          med.brandName || med.genericIngredient || med.name,
                          patientProfile?.allergies || []
                        );

                        return (
                          <div key={medIdx} className="p-3 rounded-xl bg-[#F8FAF8] border border-[#E6ECE8] space-y-2 text-xs">
                            <div className="flex items-start justify-between">
                              <div className="flex items-center gap-2">
                                <Pill className="w-4 h-4 text-[#238B78]" />
                                <span className="font-bold text-sm text-[#202B28]">
                                  {med.brandName || med.name || med.rawRecognizedName}
                                </span>
                              </div>
                              <Badge variant="primary" size="sm">{med.strength || 'Standard'}</Badge>
                            </div>

                            {allergyConflict && (
                              <div className="p-2 rounded-lg bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-center gap-1.5 font-semibold">
                                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                                <span>⚠️ Allergy Warning: Matches documented allergy to "{allergyConflict}"!</span>
                              </div>
                            )}

                            {med.genericIngredient && (
                              <p className="text-[11px] text-[#7A8782]">
                                <strong>Generic:</strong> {med.genericIngredient}
                              </p>
                            )}

                          <div className="grid grid-cols-2 gap-2 text-[11px] text-[#7A8782]">
                            <div>
                              <strong>Schedule:</strong> {med.frequency || 'Once daily'}
                            </div>
                            <div>
                              <strong>Timing:</strong> {(med.timeSlots || []).join(', ') || 'Morning'}
                            </div>
                          </div>

                          {med.instructions && (
                            <p className="text-[11px] text-[#7A8782] bg-white p-2 rounded-lg border border-[#E6ECE8]">
                              <strong>Instructions:</strong> {med.instructions}
                            </p>
                          )}
                        </div>
                      );
                    }))}
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Mandatory Professional Medical Disclaimer Callout */}
          <div className="p-4 rounded-2xl bg-amber-50/90 border-2 border-amber-300 text-amber-950 space-y-2 shadow-xs">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-700 flex-shrink-0" />
              <h4 className="font-bold text-xs uppercase tracking-wider text-amber-900">
                Mandatory Professional Medical Disclaimer
              </h4>
            </div>
            <p className="text-xs text-amber-950 font-semibold leading-relaxed">
              MedRemind is an organizational routine organizer and reminder tool. It does not provide medical advice, diagnosis, or clinical treatment plans.
            </p>
            <p className="text-[11px] text-amber-900/90 leading-relaxed">
              Optical character recognition (OCR) and automated entity extraction are assistive computer drafts only and can contain errors or misreadings. You are strictly required to verify all recognized medicine names, active strengths, daily frequencies, and instructions against your physical paper prescription. Never initiate, change, or cease prescribed medication routines without consulting your licensed physician or pharmacist.
            </p>
          </div>

          {/* Master Patient Confirmation */}
          <div className="p-4 rounded-2xl bg-white border border-[#E6ECE8] space-y-3">
            <label className="flex items-start gap-2.5 cursor-pointer text-xs text-[#202B28] leading-relaxed">
              <input
                type="checkbox"
                checked={masterConfirmed}
                onChange={(e) => setMasterConfirmed(e.target.checked)}
                className="accent-[#238B78] w-4 h-4 rounded mt-0.5 flex-shrink-0"
              />
              <span>
                I confirm that I have reviewed the recognized medicine names, strengths, and scheduled daily dosage instructions against my physical prescription document.
              </span>
            </label>

            <div className="flex gap-2.5 pt-1">
              <Button
                variant="outline"
                fullWidth
                size="md"
                onClick={handleDiscardBatch}
              >
                Discard
              </Button>
              <Button
                fullWidth
                size="md"
                disabled={!masterConfirmed}
                onClick={handleApproveBatch}
              >
                Approve & Add to Routine
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}