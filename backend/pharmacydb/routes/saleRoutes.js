import express from 'express';
import mongoose from 'mongoose';
import { protect } from '../middleware/authMiddleware.js';
import { logActivity } from '../utils/logActivity.js'; // 🔥 Added logging utility
import Prescription from '../models/Prescription.js';
import Inventory from '../models/Inventory.js';
import Sale from '../models/Sale.js';
import Medicine from '../models/Medicine.js';
import Order from '../models/Order.js';
import Patient from '../models/Patient.js';
import SystemSettings from '../models/SystemSettings.js';
import Payment from '../models/Payment.js';
import PharmacyPatient from '../models/PharmacyPatient.js';

const router = express.Router();

console.log("🛠️  DEBUG: BILLING_MONGO_URI is:", process.env.BILLING_MONGO_URI ? "FOUND ✅" : "MISSING ❌");
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
// 2. GET ALL SALES (History with Auto-Sync)
// ==============================================================================
router.get('/', async (req, res) => {
    try {
        const sales = await Sale.find().populate('pharmacist', 'name role').sort({ createdAt: -1 });
        const salesData = sales.map(sale => sale.toObject());

        if (ExternalPayment) {
            // Grab all completed payments from the Billing DB
            const allPayments = await ExternalPayment.find({
                status: { $in: ["completed", "Completed", "paid", "Paid"] }
            }).lean();

            for (let sale of salesData) {
                if (sale.paymentStatus === 'Pending') {
                    const myAmount = Number(sale.totalAmount);
                    const myName = (sale.patientName || 'Walk-in').toLowerCase().trim();

                    // 🔍 Try to find a match in their DB
                    const match = allPayments.find(p => {
                        const theirAmount = Number(p.amount);
                        const theirName = (p.patientName || 'Walk-in').toLowerCase().trim();

                        // Match if price is within 1 peso AND the name is similar
                        const priceMatch = Math.abs(theirAmount - myAmount) < 1.0;
                        const nameMatch = theirName.includes(myName) || myName.includes(theirName);

                        return priceMatch && nameMatch;
                    });

                    if (match) {
                        console.log(`✅ Auto-Sync: Match found for ${sale.patientName} (₱${myAmount})`);
                        sale.paymentStatus = 'Paid';
                        // Save it so your DB remembers it for next time
                        await Sale.findByIdAndUpdate(sale._id, { paymentStatus: 'Paid' });
                    }
                }
            }
        }
        res.status(200).json(salesData);
    } catch (error) {
        console.error("Billing View Error:", error);
        res.status(500).json({ message: error.message });
    }
});

// ==============================================================================
// 3. SYNC STATUS (Billing Integration) - HYBRID MATCHING (VAT AWARE)
// ==============================================================================
router.post('/sync', protect, async (req, res) => {
    try {
        if (!ExternalPayment) {
            return res.status(503).json({ message: "Billing DB connection not configured." });
        }

        const pendingSales = await Sale.find({ paymentStatus: 'Pending' });
        if (pendingSales.length === 0) {
            return res.json({ message: "No pending sales to sync.", updated: 0 });
        }

        const allPayments = await ExternalPayment.find({
            status: { $regex: /completed|paid/i }
        }).sort({ createdAt: -1 }).lean();

        let updatedCount = 0;
        
        for (const sale of pendingSales) {
            const myName = (sale.patientName || '').toLowerCase().trim();
            const myAmount = Number(sale.totalAmount) || 0;
            const isWalkIn = myName.includes('walk') || myName.includes('guest') || myName === '';

            // Inside router.post('/sync', ...
            const match = allPayments.find(p => {
                const theirName = (p.patientName || '').toLowerCase().trim();
                const nameMatch = theirName.includes(myName) || myName.includes(theirName);
                
                // 🔥 ADD THIS DATE CHECK:
                // Only match if the payment in Billing was created AFTER the sale in Pharmacy
                const paymentDate = new Date(p.createdAt || p.date);
                const saleDate = new Date(sale.createdAt || sale.date);
                const isRecent = paymentDate >= saleDate;

                if (isWalkIn) {
                    const theirAmount = Number(p.amount) || 0;
                    const amountWithVAT = myAmount * 1.12;
                    const isExactMatch = Math.abs(theirAmount - myAmount) < 1.0;
                    const isVatMatch = Math.abs(theirAmount - amountWithVAT) < 1.0;
                    const isGenericName = theirName.includes('walk') || theirName.includes('guest');
                    
                    return (nameMatch || isGenericName) && (isExactMatch || isVatMatch) && isRecent;
                } else {
                    // For registered patients, match by Name AND ensure it's a recent payment
                    return nameMatch && isRecent;
                }
            });

            if (match) {
                sale.paymentStatus = 'Paid';
                await sale.save();
                
                await logActivity(req, {
                    action: 'SYNC_BILLING',
                    module: 'Sales & Billing',
                    description: `Automated Sync: Marked sale for ${sale.patientName} as PAID.`,
                    targetId: sale._id.toString()
                });
                
                updatedCount++;
            }
        }
        res.json({ message: "Sync complete.", updated: updatedCount });

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

        // 🔥 LOG EMR DISPENSE ACTIVITY WITH MEDICINE NAMES
        const medNames = [...new Set(itemsSold.map(item => item.name))].join(', ');
        await logActivity(req, {
            action: 'DISPENSE_PRESCRIPTION',
            module: 'Patient Records', // 🔥 Changed from 'Counter Dispensing'
            description: `Dispensed prescription(s) for APT patient '${emrPatient.firstname} ${emrPatient.lastname}'. Items: ${medNames}. Total: ₱${totalAmount.toFixed(2)}`,
            targetId: sale._id.toString()
        });

        console.log(`✅ Sale Created: ${sale._id}. Waiting for Billing System to pick it up.`);
        res.status(200).json({ message: 'Dispensing successful', sale });

    } catch (err) {
        console.error("Dispense Error:", err.message);
        res.status(500).json({ message: err.message || 'Server Error' });
    }
});

// Helper Function: Auto-Order
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

        // 🔥 LOG BATCH DISPENSE ACTIVITY
        await logActivity(req, {
            action: 'DISPENSE_PRESCRIPTION',
            module: 'Patient Records', // 🔥 Changed from 'Counter Dispensing'
            description: `Batch dispensed ${result.modifiedCount} pending prescription(s) system-wide.`
        });

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

        const dummyPatientId = new mongoose.Types.ObjectId(); 

        // Create Sale Record for Walk-in
        const sale = await Sale.create({
            patient: dummyPatientId, // <-- We now send the dummy ID to Billing!
            patientName: `Walk-in Customer`, 
            pharmacist: req.user._id,
            items: itemsSold,
            totalAmount: totalAmount,
            paymentStatus: 'Pending',
            date: Date.now()
        });

        // 🔥 LOG OTC SALE ACTIVITY WITH MEDICINE NAMES
        const medNames = [...new Set(itemsSold.map(item => item.name))].join(', ');
        await logActivity(req, {
            action: 'CREATE_SALE',
            module: 'Counter Dispensing',
            description: `Processed OTC sale for Walk-in Customer. Items: ${medNames}. Total: ₱${totalAmount.toFixed(2)}`,
            targetId: sale._id.toString()
        });

        res.status(200).json({ message: 'OTC Transaction successful', sale });

    } catch (err) {
        console.error("OTC Sale Error:", err.message);
        res.status(500).json({ message: err.message || 'Server Error' });
    }
});

export default router;