import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/authMiddleware.js';
import Prescription from '../models/Prescription.js';
import Inventory from '../models/Inventory.js';
import Sale from '../models/Sale.js';
import Medicine from '../models/Medicine.js';
import Order from '../models/Order.js';
import Patient from '../models/Patient.js';
import SystemSettings from '../models/SystemSettings.js';

const router = express.Router();

// ==============================================================================
// 1. SETUP SECONDARY CONNECTION TO BILLING DB (READ-ONLY)
// ==============================================================================
const billingDbUri = process.env.BILLING_MONGO_URI;
let ExternalPayment;

if (billingDbUri) {
    try {
        const billingConn = mongoose.createConnection(billingDbUri);
        const paymentSchema = new mongoose.Schema({
            pharmacyReferenceId: String, 
            status: String,              
            transactionId: String        
        }, { strict: false });

        ExternalPayment = billingConn.model('Payment', paymentSchema, 'payments');
        console.log("✅ Connected to External Billing DB (Collection: payments)");
    } catch (err) {
        console.error("❌ Billing DB Connection Error:", err.message);
    }
}

// ==============================================================================
// 2. GET ALL SALES (History)
// ==============================================================================
router.get('/', protect, async (req, res) => {
    try {
        const sales = await Sale.find({})
            .populate('pharmacist', 'name')
            .populate({ path: 'items.medicine', select: 'name strength' })
            .sort({ date: -1 })
            .lean(); 

        const patientIds = sales
            .map(s => s.patient)
            .filter(id => id && mongoose.Types.ObjectId.isValid(id));

        const patients = await Patient.find({ _id: { $in: patientIds } })
            .select('firstname lastname patientId')
            .lean();

        const patientMap = {};
        patients.forEach(p => { patientMap[p._id.toString()] = p; });

        sales.forEach(sale => {
            if (sale.patient && patientMap[sale.patient.toString()]) {
                const p = patientMap[sale.patient.toString()];
                sale.patient = {
                    _id: p._id,
                    patientId: p.patientId, 
                    name: `${p.firstname} ${p.lastname}`
                };
                sale.patientName = `${p.firstname} ${p.lastname}`;
            }
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
// 3. SYNC STATUS (Billing Integration)
// ==============================================================================
router.post('/sync', protect, async (req, res) => {
    try {
        const settings = await SystemSettings.findOne();
        if (!settings || !settings.billing.enabled) {
            return res.status(400).json({ 
                message: "Billing integration is currently DISABLED in System Settings.",
                updated: 0 
            });
        }

        if (!ExternalPayment) {
            return res.status(503).json({ message: "Billing DB connection not configured in .env." });
        }

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
// 4. DISPENSE MEDICINE (Writes directly to EMR Database!)
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
        
        // 🔥 NEW LOGIC: Only target prescriptions that are NOT marked as dispensed
        const prescriptions = allPrescriptions.filter(p => p.status !== 'Dispensed' && p.status !== 'Completed');

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

                await checkAndAutoOrder(medicineDoc._id, price);
            }
            if (quantityNeeded > 0) throw new Error(`Insufficient stock for ${medicineDoc.name}`);
        }

        // Create Sale
        const sale = await Sale.create({
            patient: patientId,
            patientName: `${emrPatient.firstname} ${emrPatient.lastname}`,
            pharmacist: req.user._id,
            items: itemsSold,
            totalAmount: totalAmount,
            paymentStatus: 'Pending', 
            date: Date.now()
        });

        // 🔥 THE MAGIC SAUCE: DIRECTLY UPDATE THE EMR DATABASE! 🔥
        const prescriptionIds = prescriptions.map(p => p._id);
        if (prescriptionIds.length > 0) {
            await Prescription.updateMany(
                { _id: { $in: prescriptionIds } },
                { $set: { status: 'Dispensed' } } // Writes directly to their system!
            );
            console.log(`✅ Updated ${prescriptionIds.length} EMR records to 'Dispensed'`);
        }

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

router.post('/dispense-all', protect, async (req, res) => {
    try {
        const result = await Prescription.updateMany(
            { 
                $or: [
                    { status: "Pending" },       
                    { status: { $exists: false } }, 
                    { status: null },            
                    { status: "" }                
                ]
            }, 
            { $set: { status: "Dispensed" } }
        );

        if (result.matchedCount === 0) {
            return res.status(200).json({ message: "No pending prescriptions found." });
        }

        res.status(200).json({ 
            message: `Successfully dispensed ${result.modifiedCount} prescriptions.` 
        });

    } catch (err) {
        console.error("Dispense All Error:", err);
        res.status(500).json({ message: 'Server Error during batch dispense' });
    }
});

// ==============================================================================
// 5. OTC DISPENSE (Over the Counter / Walk-in)
// ==============================================================================
router.post('/otc', protect, async (req, res) => {
    try {
        const { items, paymentMethod, amountReceived } = req.body;
        // items expects an array: [{ medicineId, quantity }]
        
        if (!items || items.length === 0) {
            return res.status(400).json({ message: 'Cart is empty' });
        }

        let totalAmount = 0;
        const itemsSold = [];

        // Inventory FEFO Logic
        for (const reqItem of items) {
            const medicineDoc = await Medicine.findById(reqItem.medicineId);
            if (!medicineDoc) throw new Error(`Medicine not found`);

            const batches = await Inventory.find({ 
                medicine: medicineDoc._id, 
                quantity: { $gt: 0 },
                isArchived: false 
            }).sort({ expiryDate: 1 }); // Oldest expiry first!

            let quantityNeeded = parseInt(reqItem.quantity) || 0;
            if (batches.length === 0) throw new Error(`No stock for ${medicineDoc.name}`);

            for (let batch of batches) {
                if (quantityNeeded <= 0) break;
                
                let takeAmount = (batch.quantity >= quantityNeeded) ? quantityNeeded : batch.quantity;
                batch.quantity -= takeAmount;
                quantityNeeded -= takeAmount;
                
                await batch.save(); // Deduct live stock

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

                await checkAndAutoOrder(medicineDoc._id, price);
            }
            if (quantityNeeded > 0) throw new Error(`Insufficient stock for ${medicineDoc.name}`);
        }

        // Create Sale Record for Walk-in
        const sale = await Sale.create({
            patientName: `Walk-in Customer`, // No EMR ID needed!
            pharmacist: req.user._id,
            items: itemsSold,
            totalAmount: totalAmount,
            paymentStatus: 'Paid', // OTC is paid instantly
            date: Date.now()
        });

        res.status(200).json({ message: 'OTC Transaction successful', sale });

    } catch (err) {
        console.error("OTC Sale Error:", err.message);
        res.status(500).json({ message: err.message || 'Server Error' });
    }
});

export default router;