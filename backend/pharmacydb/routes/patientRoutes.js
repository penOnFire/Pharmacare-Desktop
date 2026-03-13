import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/authMiddleware.js';
import { emrConnection } from '../config/db.js'; 
import Patient from '../models/Patient.js'; 
import SystemSettings from '../models/SystemSettings.js';
import Prescription from '../models/Prescription.js'; 
import Sale from '../models/Sale.js'; 

const router = express.Router();

// --- 1. DEFINE THE ARCHIVE MODEL ---
const ArchiveAppointment = emrConnection.model('ArchiveAppointment', new mongoose.Schema({
    patientId: String,
    startedAt: Date 
}), 'archiveappointments');

router.get('/', protect, async (req, res) => {
  try {
    const settings = await SystemSettings.findOne();
    if (!settings || !settings.emr.enabled) {
        return res.json([]); 
    }

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

    const [allPrescriptions, allSales, latestConsultations] = await Promise.all([
        Prescription.find({ patientId: { $in: patientIds } }).lean(),
        Sale.find({ patient: { $in: mongoIds } }).select('items').lean(),
        ArchiveAppointment.aggregate([
            { $match: { patientId: { $in: patientIds } } },
            { $group: { _id: "$patientId", lastDate: { $max: "$startedAt" } } }
        ])
    ]);

    const consultationMap = {};
    latestConsultations.forEach(c => {
        consultationMap[c._id] = c.lastDate;
    });

    let formattedPatients = patientsRaw.map(p => {
        if (!p.patientId) return formatPatient(p, 'No Prescription', p.createdAt, null);

        const pIdClean = String(p.patientId).trim();
        const myPrescriptions = allPrescriptions.filter(rx => String(rx.patientId).trim() === pIdClean);
        
        let status = 'No Prescription'; 
        let lastActivity = p.createdAt;

        if (myPrescriptions.length > 0) {
            const lastRx = myPrescriptions.reduce((latest, current) => 
                new Date(latest.createdAt) > new Date(current.createdAt) ? latest : current
            );
            lastActivity = lastRx.createdAt;
        }

        // --- CORE STATUS LOGIC FIX ---
        if (myPrescriptions.length > 0) {
            
            const validPrescriptions = myPrescriptions.filter(rx => {
                if (!rx.medicname || typeof rx.medicname !== 'string') return false;
                if (rx.medicname.trim() === "") return false;
                return true; 
            });

            if (validPrescriptions.length > 0) {
                // Check what is pending DIRECTLY via the EMR Status!
                const pendingItems = validPrescriptions.filter(rx => {
                    return rx.status !== 'Dispensed' && rx.status !== 'Completed';
                });

                if (pendingItems.length > 0) {
                    status = 'Pending';
                } else {
                    status = 'Completed';
                }
            }
        }

        const consultDate = consultationMap[p.patientId] || null;
        return formatPatient(p, status, lastActivity, consultDate);
    });

    // --- FILTERS & SORTING (Unchanged) ---
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
            // 🔥 Switched back to filtering by consultationDate
            if (!p.consultationDate) return false; 
            
            const d = new Date(p.consultationDate); 
            
            if (req.query.date === 'today') {
                return d.toDateString() === now.toDateString();
            }
            if (req.query.date === 'week') {
                const weekAgo = new Date(); 
                weekAgo.setDate(now.getDate() - 7);
                return d >= weekAgo;
            }
            if (req.query.date === 'month') {
                const monthAgo = new Date(); 
                monthAgo.setDate(now.getDate() - 30);
                return d >= monthAgo;
            }
            if (req.query.date === 'last-year') {
                const yearAgo = new Date(); 
                yearAgo.setFullYear(now.getFullYear() - 1);
                return d >= yearAgo;
            }
            return true;
        });
    }

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
        consultationDate: consultationDate 
    };
}

function calculateAge(dob) {
    if (!dob) return 'N/A';
    const diff = Date.now() - new Date(dob).getTime();
    const ageDate = new Date(diff);
    return Math.abs(ageDate.getUTCFullYear() - 1970);
}

export default router;