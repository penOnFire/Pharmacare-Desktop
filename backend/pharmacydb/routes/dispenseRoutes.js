// dispenseRoutes.js
import { logActivity } from '../utils/logActivity.js';
import express from "express";
import mongoose from "mongoose";
import Prescription from "../models/Prescription.js"; // adjust path/name if different
import Medicine from "../models/Medicine.js"; // adjust if different

const router = express.Router();

/**
 * Dispense a single prescription item
 * POST /api/prescriptions/:prescriptionId/items/:itemId/dispense
 * Body: { qty: Number }  // optional, default = remaining qty
 *
 * Returns JSON: { prescription: <updatedPrescription>, dispensed: { item, qty, timestamp } }
 */
router.post(
  "/prescriptions/:prescriptionId/items/:itemId/dispense",
  async (req, res) => {
    try {
      const { prescriptionId, itemId } = req.params;
      const requestedQty = Number(req.body.qty || 0);

      if (!mongoose.isValidObjectId(prescriptionId) || !mongoose.isValidObjectId(itemId)) {
        return res.status(400).json({ message: "Invalid id(s)" });
      }

      const prescription = await Prescription.findById(prescriptionId).lean();
      if (!prescription) return res.status(404).json({ message: "Prescription not found" });

      // Find item inside prescription
      const item = (prescription.items || []).find(i => String(i._id) === String(itemId));
      if (!item) return res.status(404).json({ message: "Item not found in prescription" });

      const remaining = (item.qty || 0) - (item.dispensedQty || 0);
      if (remaining <= 0) {
        return res.status(400).json({ message: "Item already fully dispensed" });
      }

      const dispenseQty = requestedQty > 0 ? Math.min(requestedQty, remaining) : remaining;

      // Update prescription item: increment dispensedQty, set item.status if fully dispensed
      const updatePath1 = {};
      updatePath1[`items.$[it].dispensedQty`] = (item.dispensedQty || 0) + dispenseQty;
      if (dispenseQty === remaining) updatePath1[`items.$[it].status`] = "dispensed";

      // If your model uses different keys change above. Using arrayFilters to update the specific item.
      const updated = await Prescription.findOneAndUpdate(
        { _id: prescriptionId },
        { $set: updatePath1 },
        {
          arrayFilters: [{ "it._id": mongoose.Types.ObjectId(itemId) }],
          new: true,
          runValidators: true
        }
      ).lean();

      // Re-evaluate overall prescription status: if all items dispensed => completed, else partial
      const updatedItems = updated.items || [];
      const allDispensed = updatedItems.every(it => (it.qty || 0) === (it.dispensedQty || 0));
      const newStatus = allDispensed ? "completed" : "partial";

      await Prescription.findByIdAndUpdate(prescriptionId, { status: newStatus });

      // OPTIONAL: decrement medicine stock (simple approach). If your system uses batch-level logic adapt here.
      try {
        if (item.medicineId) {
          await Medicine.findByIdAndUpdate(item.medicineId, {
            $inc: { stock: -dispenseQty }
          });
        }
      } catch (e) {
        // do not fail entire request if inventory update fails; log and continue
        console.error("Stock decrement error:", e);
      }

      // Create a small dispensed record to return to frontend
      const dispensedRecord = {
        prescriptionId: updated._id,
        itemId,
        name: item.name || item.medicineName || "Unknown",
        medicineId: item.medicineId || null,
        qty: dispenseQty,
        timestamp: new Date().toISOString(),
        dispensedBy: req.user ? req.user._id : null // if you have auth
      };

      // Fetch final version of prescription to return
      const finalPrescription = await Prescription.findById(prescriptionId).lean();

      return res.json({
        message: "Dispensed",
        prescription: finalPrescription,
        dispensed: dispensedRecord
      });
    } catch (err) {
      console.error("Dispense error:", err);
      return res.status(500).json({ message: "Could not dispense item", error: err.message });
    }
  }
);

/**
 * Dispense all items for a prescription
 * POST /api/prescriptions/:prescriptionId/dispense-all
 */
router.post("/prescriptions/:prescriptionId/dispense-all", async (req, res) => {
  try {
    const { prescriptionId } = req.params;
    if (!mongoose.isValidObjectId(prescriptionId)) return res.status(400).json({ message: "Invalid id" });

    const prescription = await Prescription.findById(prescriptionId);
    if (!prescription) return res.status(404).json({ message: "Prescription not found" });

    const dispensedRecords = [];

    for (const it of prescription.items) {
      const remaining = (it.qty || 0) - (it.dispensedQty || 0);
      if (remaining <= 0) continue;

      it.dispensedQty = (it.dispensedQty || 0) + remaining;
      it.status = "dispensed";

      // decrement stock per item (simple)
      if (it.medicineId) {
        try {
          await Medicine.findByIdAndUpdate(it.medicineId, { $inc: { stock: -remaining } });
        } catch (e) {
          console.error("Stock decrement error for item", it._id, e);
        }
      }

      dispensedRecords.push({
        prescriptionId: prescription._id,
        itemId: it._id,
        name: it.name || it.medicineName || "Unknown",
        medicineId: it.medicineId || null,
        qty: remaining,
        timestamp: new Date().toISOString(),
        dispensedBy: req.user ? req.user._id : null
      });
    }

    prescription.status = "completed";
    await prescription.save();

    return res.json({
      message: "All items dispensed",
      prescription,
      dispensed: dispensedRecords
    });
  } catch (err) {
    console.error("Dispense all error:", err);
    return res.status(500).json({ message: "Could not dispense all items", error: err.message });
  }
});

export default router;
