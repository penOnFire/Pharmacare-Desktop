import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/authMiddleware.js';
import { emrConnection } from '../config/db.js'; // Ensure this exists!
import Patient from '../models/Patient.js'; 
import SystemSettings from '../models/SystemSettings.js';
import Prescription from '../models/Prescription.js'; 
import Sale from '../models/Sale.js'; 

const router = express.Router();

// --- 1. DEFINE THE ARCHIVE MODEL (Strictly based on your screenshot) ---
// This connects to the 'archiveappointments' collection in the EMR database
const ArchiveAppointment = emrConnection.model('ArchiveAppointment', new mongoose.Schema({
    patientId: String,
    startedAt: Date  // Matches the field in your image
}), 'archiveappointments');

// @route   GET /api/patients
// @desc    Search patients with Status & Consultation Date
router.get('/', protect, async (req, res) => {
  try {
    const settings = await SystemSettings.findOne();
    if (!settings || !settings.emr.enabled) {
        return res.json([]); 
    }

    // 1. Search Query
    const keyword = req.query.search
      ? {
          $or: [
            { firstname: { $regex: req.query.search, $options: 'i' } },
            { lastname: { $regex: req.query.search, $options: 'i' } },
            { patientId: { $regex: req.query.search, $options: 'i' } },
          ],
        }
      : {};

    const patientsRaw = await Patient.find(keyword).lean(); 
    if (patientsRaw.length === 0) return res.json([]);

    const patientIds = patientsRaw.map(p => p.patientId).filter(id => id); 
    const mongoIds = patientsRaw.map(p => p._id);

    // --- 2. FETCH DATA (Including Consultations) ---
    console.log(`🔎 Looking up consultations for ${patientIds.length} patients...`);

    const [allPrescriptions, allSales, latestConsultations] = await Promise.all([
        Prescription.find({ patientId: { $in: patientIds } }).lean(),
        Sale.find({ patient: { $in: mongoIds } }).select('items').lean(),
        
        // AGGREGATION: Grab the latest 'startedAt' for each patient
        ArchiveAppointment.aggregate([
            { $match: { patientId: { $in: patientIds } } },
            { $group: {
                _id: "$patientId",
                lastDate: { $max: "$startedAt" } // Use startedAt as requested
            }}
        ])
    ]);

    console.log("✅ Consultations Found:", latestConsultations); // CHECK YOUR TERMINAL FOR THIS!

    // Create Map: { "P013": "2025-12-09..." }
    const consultationMap = {};
    latestConsultations.forEach(c => {
        consultationMap[c._id] = c.lastDate;
    });

    // --- 3. MAP STATUS & DATES ---
    // --- 3. MAP STATUS & DATES ---
    let formattedPatients = patientsRaw.map(p => {
        if (!p.patientId) return formatPatient(p, 'No Prescription', p.createdAt, null);

        const pIdClean = String(p.patientId).trim();
        
        // 1. Get EMR Prescriptions
        const myPrescriptions = allPrescriptions.filter(rx => String(rx.patientId).trim() === pIdClean);
        
        // 2. Get Local Sales (Dispensed History)
        const mySales = allSales.filter(s => s.patient && s.patient.toString() === p._id.toString());

        // 3. Create a list of medicines we have ALREADY dispensed (normalize text)
        const dispensedNames = mySales.flatMap(sale => 
            sale.items.map(item => (item.name || "").toLowerCase().trim())
        );

        let status = 'No Prescription'; 
        let lastActivity = p.createdAt;

        // Determine Last Activity (for sorting)
        if (myPrescriptions.length > 0) {
            const lastRx = myPrescriptions.reduce((latest, current) => 
                new Date(latest.createdAt) > new Date(current.createdAt) ? latest : current
            );
            lastActivity = lastRx.createdAt;
        }

        // --- CORE STATUS LOGIC FIX ---
        if (myPrescriptions.length > 0) {
            
            // STEP A: Clean the EMR Data first!
            // We strictly ignore any prescription that has no name or is too old
            const validPrescriptions = myPrescriptions.filter(rx => {
                // 1. Must have a real name (fixes the "Ghost Data" bug)
                if (!rx.medicname || typeof rx.medicname !== 'string') return false;
                if (rx.medicname.trim() === "") return false;

                // 2. (Optional) Ignore prescriptions older than 30 days? 
                // This prevents ancient history from showing as "Pending"
                // const thirtyDaysAgo = new Date();
                // thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
                // if (new Date(rx.createdAt || rx.date) < thirtyDaysAgo) return false;

                return true; 
            });

            // STEP B: Check against your Sales
            const pendingItems = validPrescriptions.filter(rx => {
                const rxName = rx.medicname.toLowerCase().trim();
                // If the medicine is NOT in the dispensed list, it is Pending
                return !dispensedNames.includes(rxName);
            });

            if (pendingItems.length > 0) {
                // We found valid medicines that haven't been sold yet
                status = 'Pending';
            } else {
                // If we have prescriptions but NO pending items, check dates
                const oneDayAgo = new Date();
                oneDayAgo.setHours(oneDayAgo.getHours() - 24);
                
                // If last activity was recent, it's "Completed", otherwise just history
                status = (new Date(lastActivity) > oneDayAgo) ? 'Completed' : 'No Prescription';
            }
        }

        // GRAB CONSULTATION DATE
        const consultDate = consultationMap[p.patientId] || null;

        return formatPatient(p, status, lastActivity, consultDate);
    });

    // --- 4. APPLY FILTERS ---
    if (req.query.status && req.query.status !== 'all') {
        const filterStatus = req.query.status.toLowerCase();
        formattedPatients = formattedPatients.filter(p => {
            const s = p.status.toLowerCase();
            if (filterStatus === 'active') return s === 'no prescription';
            return s === filterStatus;
        });
    }

    if (req.query.date && req.query.date !== 'all') {
        const now = new Date();
        formattedPatients = formattedPatients.filter(p => {
            const d = new Date(p.lastActivity); 
            if (req.query.date === 'today') return d.toDateString() === now.toDateString();
            if (req.query.date === 'week') {
                const weekAgo = new Date(); weekAgo.setDate(now.getDate() - 7);
                return d >= weekAgo;
            }
            if (req.query.date === 'month') {
                const monthAgo = new Date(); monthAgo.setDate(now.getDate() - 30);
                return d >= monthAgo;
            }
            if (req.query.date === 'last-year') {
                const yearAgo = new Date(); yearAgo.setFullYear(now.getFullYear() - 1);
                return d >= yearAgo;
            }
            return true;
        });
    }

    // --- 5. SORT ---
    formattedPatients.sort((a, b) => {
        const score = (s) => {
            if (s === 'Pending') return 3;
            if (s === 'Completed') return 2;
            return 1; 
        };
        
        if (score(a.status) !== score(b.status)) {
            return score(b.status) - score(a.status);
        }
        return new Date(b.lastActivity) - new Date(a.lastActivity);
    });

    res.json(formattedPatients);

  } catch (err) {
    console.error("Patient Route Error:", err);
    res.status(500).json({ message: 'Error connecting to EMR' });
  }
});

function formatPatient(p, status, lastActivity, consultationDate) {
    return {
        _id: p._id,
        patientId: p.patientId || "N/A",
        name: `${p.firstname} ${p.lastname}`,
        age: p.dob ? calculateAge(p.dob) : 'N/A',
        gender: p.gender,
        contactNo: p.phone || 'N/A',
        status: status, 
        lastActivity: lastActivity,
        consultationDate: consultationDate // <--- THIS is what the frontend needs
    };
}

function calculateAge(dob) {
    if (!dob) return 'N/A';
    const diff = Date.now() - new Date(dob).getTime();
    const ageDate = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
}

export default router;