import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/authMiddleware.js';
import Prescription from '../models/Prescription.js';
import Inventory from '../models/Inventory.js';
import Sale from '../models/Sale.js';
import Medicine from '../models/Medicine.js';
import Order from '../models/Order.js';
import Patient from '../models/Patient.js';

const router = express.Router();

// ==============================================================================
// 1. SETUP SECONDARY CONNECTION TO BILLING DB (READ-ONLY)
// ==============================================================================
const billingDbUri = process.env.BILLING_MONGO_URI;
let ExternalPayment;



if (billingDbUri) {
    try {
        const billingConn = mongoose.createConnection(billingDbUri);
        
        // Define a schema for THEIR 'payments' collection
        // We only need to read the fields that link back to us
        const paymentSchema = new mongoose.Schema({
            pharmacyReferenceId: String, // This matches your Sale._id
            status: String,              // e.g., 'Paid', 'Completed'
            transactionId: String        // Their reference number
        }, { strict: false });

        // Connect to their 'payments' collection
        ExternalPayment = billingConn.model('Payment', paymentSchema, 'payments');
        console.log("✅ Connected to External Billing DB (Collection: payments)");
    } catch (err) {
        console.error("❌ Billing DB Connection Error:", err.message);
    }
}

if (billingDbUri) {
    try {
        const billingConn = mongoose.createConnection(billingDbUri);
        const paymentSchema = new mongoose.Schema({
            pharmacyReferenceId: String,
            status: String,
            transactionId: String
        }, { strict: false });
        ExternalPayment = billingConn.model('Payment', paymentSchema, 'payments');
        console.log("✅ Connected to External Billing DB");
    } catch (err) {
        console.error("❌ Billing DB Connection Error:", err.message);
    }
}

router.post('/sync', protect, async (req, res) => {
    try {
        // 1. CHECK SETTINGS FIRST!
        const settings = await SystemSettings.findOne();
        if (!settings || !settings.billing.enabled) {
            return res.status(400).json({ 
                message: "Billing integration is currently DISABLED in System Settings.",
                updated: 0 
            });
        }

        // 2. Check Connection
        if (!ExternalPayment) {
            return res.status(503).json({ message: "Billing DB connection not configured in .env." });
        }

        // 3. Proceed with Sync Logic
        const pendingSales = await Sale.find({ paymentStatus: 'Pending' });
        
        if (pendingSales.length === 0) {
            return res.json({ message: "No pending sales to sync.", updated: 0 });
        }

        let updatedCount = 0;

        for (const sale of pendingSales) {
            const paymentRecord = await ExternalPayment.findOne({ 
                pharmacyReferenceId: sale._id.toString() 
            });

            if (paymentRecord && (paymentRecord.status === 'Paid' || paymentRecord.status === 'Completed')) {
                sale.paymentStatus = 'Paid';
                sale.billingReference = paymentRecord._id || paymentRecord.transactionId; 
                await sale.save();
                updatedCount++;
            }
        }

        res.json({ message: "Sync complete", updated: updatedCount });

    } catch (err) {
        console.error("Sync Error:", err);
        res.status(500).json({ message: "Sync failed: " + err.message });
    }
});
// ==============================================================================
// 1. GET ALL SALES (History)
// ==============================================================================
router.get('/', protect, async (req, res) => {
    try {
        // 1. Fetch Sales & Populate deep nested fields
        const sales = await Sale.find({})
            .populate('pharmacist', 'name')
            // This retrieves the Medicine Name even if it wasn't saved in the item array
            .populate({
                path: 'items.medicine',
                select: 'name strength' 
            })
            .sort({ date: -1 })
            .lean(); 

        // 2. Extract Patient IDs for manual fetch (Cross-DB support)
        const patientIds = sales
            .map(s => s.patient)
            .filter(id => id && mongoose.Types.ObjectId.isValid(id));

        // 3. Fetch Patients from EMR DB
        const patients = await Patient.find({ _id: { $in: patientIds } })
            .select('firstname lastname patientId')
            .lean();

        const patientMap = {};
        patients.forEach(p => {
            patientMap[p._id.toString()] = p;
        });

        // 4. Merge Data
        sales.forEach(sale => {
            // Fix Patient Info
            if (sale.patient && patientMap[sale.patient.toString()]) {
                const p = patientMap[sale.patient.toString()];
                sale.patient = {
                    _id: p._id,
                    patientId: p.patientId, // "P006"
                    name: `${p.firstname} ${p.lastname}`
                };
                sale.patientName = `${p.firstname} ${p.lastname}`;
            }
            
            // Fix Date (Fallback to createdAt if date is missing)
            if (!sale.date && sale.createdAt) {
                sale.date = sale.createdAt;
            }
        });

        res.json(sales);

    } catch (err) {
        console.error("GET Sales Error:", err);
        res.status(500).json({ message: 'Server Error' });
    }
});

// ==============================================================================
// 3. SYNC STATUS (THE LOGIC YOU ASKED FOR)
// ==============================================================================
// This route checks the external Billing DB for any 'Pending' sales we have locally.
// If the external DB says 'Paid', we update our local record.
router.post('/sync', protect, async (req, res) => {
    try {
        if (!ExternalPayment) {
            return res.status(503).json({ message: "Billing DB connection not configured." });
        }

        // A. Find all local sales that are currently 'Pending'
        const pendingSales = await Sale.find({ paymentStatus: 'Pending' });
        
        if (pendingSales.length === 0) {
            return res.json({ message: "No pending sales to sync.", updated: 0 });
        }

        let updatedCount = 0;

        // B. Loop through them and check the external database
        for (const sale of pendingSales) {
            // We search their 'payments' collection for a record that has OUR Sale ID
            const paymentRecord = await ExternalPayment.findOne({ 
                pharmacyReferenceId: sale._id.toString() 
            });

            // C. If found and status is 'Paid' (or whatever they use), update ours
            if (paymentRecord && (paymentRecord.status === 'Paid' || paymentRecord.status === 'Completed')) {
                sale.paymentStatus = 'Paid';
                // Optional: Save their ID for reference
                sale.billingReference = paymentRecord._id || paymentRecord.transactionId; 
                await sale.save();
                updatedCount++;
            }
        }

        res.json({ message: "Sync complete", updated: updatedCount });

    } catch (err) {
        console.error("Sync Error:", err);
        res.status(500).json({ message: "Sync failed: " + err.message });
    }
});

// ==============================================================================
// 4. DISPENSE MEDICINE (Create Sale Only)
// ==============================================================================
router.post('/dispense/:patientId', protect, async (req, res) => {
    try {
        const { patientId } = req.params; 
        console.log(`➡️ Dispensing request for Patient Mongo ID: ${patientId}`);

        const emrPatient = await Patient.findById(patientId);
        if (!emrPatient) {
            return res.status(404).json({ message: 'Patient not found in EMR' });
        }

        const allPrescriptions = await Prescription.find({ patientId: emrPatient.patientId });
        // (Assuming you have prescription filtering logic here from previous steps)
        const pastSales = await Sale.find({ patient: patientId });
        const dispensedNames = pastSales.flatMap(sale => sale.items.map(i => i.name));
        const prescriptions = allPrescriptions.filter(p => !dispensedNames.includes(p.medicname));

        if (!prescriptions || prescriptions.length === 0) {
            return res.status(400).json({ message: 'No fillable prescriptions found.' });
        }

        let totalAmount = 0;
        const itemsSold = [];

        // Inventory Logic
        for (const med of prescriptions) {
            const medicineDoc = await Medicine.findOne({ 
                name: { $regex: new RegExp(`^${med.medicname}$`, 'i') } 
            });

            if (!medicineDoc) throw new Error(`Medicine not found: ${med.medicname}`);

            const batches = await Inventory.find({ 
                medicine: medicineDoc._id, 
                quantity: { $gt: 0 },
                isArchived: false 
            }).sort({ expiryDate: 1 });

            let quantityNeeded = parseInt(med.quantity) || 0;
            if (batches.length === 0) throw new Error(`No stock for ${medicineDoc.name}`);

            for (let batch of batches) {
                if (quantityNeeded <= 0) break;
                
                let takeAmount = (batch.quantity >= quantityNeeded) ? quantityNeeded : batch.quantity;
                batch.quantity -= takeAmount;
                quantityNeeded -= takeAmount;
                
                await batch.save();

                const price = batch.sellingPrice || batch.costPrice || 0;
                const itemTotal = price * takeAmount;
                totalAmount += itemTotal;

                itemsSold.push({
                    medicine: medicineDoc._id,
                    inventory: batch._id,
                    name: medicineDoc.name,
                    quantity: takeAmount,
                    priceAtSale: price,
                    total: itemTotal
                });

                // Auto-order check
                await checkAndAutoOrder(medicineDoc._id, price);
            }
            
            if (quantityNeeded > 0) throw new Error(`Insufficient stock for ${medicineDoc.name}`);
        }

        // Create Sale - Default to Pending
        const sale = await Sale.create({
            patient: patientId,
            patientName: `${emrPatient.firstname} ${emrPatient.lastname}`,
            pharmacist: req.user._id,
            items: itemsSold,
            totalAmount: totalAmount,
            paymentStatus: 'Pending', 
            date: Date.now()
        });

        console.log(`✅ Sale Created: ${sale._id}. Waiting for Billing System to pick it up.`);
        res.status(200).json({ message: 'Dispensing successful', sale });

    } catch (err) {
        console.error("Dispense Error:", err.message);
        res.status(500).json({ message: err.message || 'Server Error' });
    }
});

// Helper Function: Auto-Order (Unchanged)
async function checkAndAutoOrder(medicineId, lastSoldPrice = 0) {
    try {
        const allBatches = await Inventory.find({ medicine: medicineId, isArchived: false });
        const totalStock = allBatches.reduce((sum, b) => sum + b.quantity, 0);
        
        if (totalStock <= 20) {
            const fullMedicine = await Medicine.findById(medicineId).populate('supplier');
            if (!fullMedicine || !fullMedicine.supplier) return;

            const existingOrder = await Order.findOne({ medicineName: fullMedicine.name, status: 'Pending' });
            if (!existingOrder) {
                let orderPrice = lastSoldPrice || 10;
                await Order.create({
                    orderId: `ORD-${Date.now().toString().slice(-6)}`,
                    supplier: fullMedicine.supplier._id,
                    supplierName: fullMedicine.supplier.name,
                    medicineName: fullMedicine.name,
                    quantity: 100,
                    unitPrice: orderPrice,
                    totalPrice: (100 * orderPrice),
                    expectedDelivery: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
                    status: 'Pending',
                    autoOrdered: true
                });
            }
        }
    } catch (e) { console.error("Auto-Order Error:", e); }
}

// In your Node.js backend routes (e.g., sales.js)
router.post('/dispense-all', protect, async (req, res) => {
    try {
        // 1. Update ALL prescriptions where status is "Pending" to "Dispensed"
        const result = await Prescription.updateMany(
            { 
        $or: [
            { status: "Pending" },        // Update items marked Pending
            { status: { $exists: false } }, // Update items with NO status field
            { status: null },             // Update items with null status
            { status: "" }                // Update items with empty string
        ]
    }, 
    { $set: { status: "Dispensed" } }
        );

        if (result.matchedCount === 0) {
            return res.status(200).json({ message: "No pending prescriptions found." });
        }

        // 2. Return success
        res.status(200).json({ 
            message: `Successfully dispensed ${result.modifiedCount} prescriptions.` 
        });

    } catch (err) {
        console.error("Dispense All Error:", err);
        res.status(500).json({ message: 'Server Error during batch dispense' });
    }
});
export default router;