import express from 'express';
import { logActivity } from '../utils/logActivity.js';
import { protect } from '../middleware/authMiddleware.js';
import Prescription from '../models/Prescription.js'; // EMR Model
import Patient from '../models/Patient.js'; // EMR Model
import Sale from '../models/Sale.js'; // Pharmacy Model

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

    // 3. Fetch LOCAL Sales history for this patient
    // 3. Fetch LOCAL Sales history for this patient
    const pastSales = await Sale.find({ patient: req.params.patientId });
    
    // Create a NORMALIZED list of sold medicines (lowercase, trimmed)
    const dispensedNames = pastSales.flatMap(sale => 
        // We add (item.name || "") to ensure it never crashes on undefined
        sale.items.map(item => (item.name || "").toLowerCase().trim()) 
    );

    // 4. FILTER: Keep only prescriptions that are NOT in the dispensed list
    const activePrescriptions = emrData.filter(p => {
        // Check if p.medicname exists before processing
        const prescribedName = (p.medicname || "").toLowerCase().trim();
        // Keep it if it hasn't been sold yet
        return !dispensedNames.includes(prescribedName);
    });

    // 5. Format for Frontend
    const formattedPrescriptions = activePrescriptions.map(p => ({
        _id: p._id,
        status: 'Pending',
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