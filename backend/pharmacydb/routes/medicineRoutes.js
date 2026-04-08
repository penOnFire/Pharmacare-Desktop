import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import Medicine from '../models/Medicine.js';
import { logActivity } from '../utils/logActivity.js'; // 🔥 Logger Imported!

const router = express.Router();

// @route   GET /api/medicines
// @desc    Get all medicines (Master Catalog for Supplies Tab)
router.get('/', protect, async (req, res) => {
  try {
    const medicines = await Medicine.find({});
    res.json(medicines);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route   POST /api/medicines
// @desc    Add a new medicine
router.post('/', protect, async (req, res) => {
  try {
    const { name, genericName, category, type, strength, supplier, requiresPrescription } = req.body;

    const newMedicine = new Medicine({
      name,
      genericName,
      category,
      type,
      strength: strength || '500mg', // Default if not provided
      supplier, 
      requiresPrescription,
    });

    const medicine = await newMedicine.save();

    // 🔥 LOG THE ACTION
    await logActivity(req, {
      action: 'ADD_MEDICINE',
      module: 'Inventory',
      description: `Added new medicine: ${medicine.name} (${medicine.strength})`,
      targetId: medicine._id.toString(),
      status: 'success'
    });

    res.status(201).json(medicine);
  } catch (err) {
    console.error(err.message);
    res.status(400).json({ message: err.message || 'Server Error' });
  }
});

// @route   GET /api/medicines/dropdown
// @desc    Get a list of medicines formatted for dropdowns
router.get('/dropdown', protect, async (req, res) => {
  try {
    const medicines = await Medicine.find({}).select('name strength');
    const dropdownList = medicines.map(med => ({
      id: med._id, 
      label: `${med.name} (${med.strength || 'N/A'})`
    }));
    res.json(dropdownList);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// @route   PUT /api/medicines/:id
// @desc    Update an existing medicine's details
router.put('/:id', protect, async (req, res) => {
  try {
    const { name, genericName, category, type, strength, supplier, requiresPrescription } = req.body;

    const updatedMedicine = await Medicine.findByIdAndUpdate(
      req.params.id,
      { name, genericName, category, type, strength, supplier, requiresPrescription },
      { new: true, runValidators: true } 
    );

    if (!updatedMedicine) {
      return res.status(404).json({ message: 'Medicine not found in database.' });
    }

    // 🔥 LOG THE UPDATE
    await logActivity(req, {
      action: 'EDIT_MEDICINE',
      module: 'Inventory',
      description: `Updated medicine details: ${updatedMedicine.name}`,
      targetId: updatedMedicine._id.toString(),
      status: 'success'
    });

    res.json({ message: 'Medicine updated successfully', data: updatedMedicine });
  } catch (err) {
    console.error("Update Error:", err.message);
    res.status(400).json({ message: err.message }); 
  }
});

// @route   DELETE /api/medicines/:id
// @desc    Delete a medicine entirely
router.delete('/:id', protect, async (req, res) => {
  try {
    const medicine = await Medicine.findByIdAndDelete(req.params.id);
    
    if (!medicine) {
      return res.status(404).json({ message: 'Medicine not found.' });
    }

    // 🔥 LOG THE DELETION
    await logActivity(req, {
      action: 'DELETE_MEDICINE',
      module: 'Inventory',
      description: `Deleted medicine: ${medicine.name}`,
      targetId: req.params.id,
      status: 'success'
    });

    res.json({ message: 'Medicine deleted successfully.' });
  } catch (err) {
    console.error("Delete Error:", err.message);
    res.status(500).json({ message: 'Server error while deleting medicine.' });
  }
});

export default router;