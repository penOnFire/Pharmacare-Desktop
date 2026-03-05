import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import Prescription from '../models/Prescription.js'; // EMR Model
import Patient from '../models/Patient.js'; // EMR Model

const router = express.Router();

// @route   GET /api/prescriptions/bypatient/:patientId
// @desc    Get ACTIVE prescriptions (Filters out already dispensed ones)
router.get('/bypatient/:patientId', protect, async (req, res) => {
  try {
    // 1. Find the Patient to get the String ID
    const patient = await Patient.findById(req.params.patientId);
    
    if (!patient) {
      return res.status(404).json({ message: 'Patient not found in EMR' });
    }

    // 2. Fetch ALL prescriptions from EMR
    const emrData = await Prescription.find({ 
        patientId: patient.patientId 
    });

    // 3. FILTER: Only keep prescriptions that are NOT Dispensed in the EMR DB
    const activePrescriptions = emrData.filter(p => {
        return p.status !== 'Dispensed' && p.status !== 'Completed';
    });

    // 4. Format for Frontend
    const formattedPrescriptions = activePrescriptions.map(p => ({
        _id: p._id,
        status: p.status || 'Pending',
        notes: p.presNotes || "No notes",
        createdAt: p.createdAt || new Date(),
        pharmacist: { name: p.presby || "Doctor" },
        medicines: [
            {
                medicine: { 
                    name: p.medicname,
                    strength: p.dosage 
                }, 
                quantity: parseInt(p.quantity) || 0,
                dosage: p.dosage,
                frequency: p.frequency
            }
        ]
    }));

    res.json(formattedPrescriptions);

  } catch (err) {
    console.error("Prescription Fetch Error:", err);
    res.status(500).json({ message: 'Server Error' });
  }
});

export default router;