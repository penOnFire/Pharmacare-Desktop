import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import Medicine from '../models/Medicine.js';
import Order from '../models/Order.js';
import Supplier from '../models/Supplier.js';
import Inventory from '../models/Inventory.js';
import { checkIntegrationEnabled, verifyApiKey } from '../middleware/integrationMiddleware.js';
const router = express.Router();

// @route   POST /api/medicines
// @desc    Add a new medicine
router.post('/', async (req, res) => {
  try {
    const { name, genericName, type, strength, supplier, requiresPrescription } =
      req.body;

    const newMedicine = new Medicine({
      name,
      genericName,
      type,
      strength,
      supplier, // This will be the ObjectId of the manufacturer
      requiresPrescription,
    });

    const medicine = await newMedicine.save();
    res.status(201).json(medicine);
  } catch (err) {
    console.error(err.message);
    res.status(500).send('Server Error');
  }
});


// @route   GET /api/medicines/dropdown
// @desc    Get a list of medicines formatted for dropdowns
// @route   GET /api/medicines/dropdown
// @desc    Get a list of medicines formatted for dropdowns
router.get('/dropdown', protect, async (req, res) => {
  try {
    // 1. Fetch name and strength
    const medicines = await Medicine.find({}).select('name strength');
    
    // 2. Map to the format your frontend script expects
    const dropdownList = medicines.map(med => ({
      id: med._id, // Important: Frontend script looks for .id or ._id
      label: `${med.name} (${med.strength || 'N/A'})`
    }));

    res.json(dropdownList);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

export default router;