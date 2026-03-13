import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import Medicine from '../models/Medicine.js';

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
    res.status(201).json(medicine);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server Error' });
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

export default router;