import express from 'express';
import Supplier from '../models/Supplier.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET all suppliers
router.get('/', protect, async (req, res) => {
  try {
    const suppliers = await Supplier.find({});
    res.json(suppliers);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST new supplier
router.post('/', protect, async (req, res) => {
  try {
    const { name, contactPerson, email, phone, address } = req.body;
    const supplier = new Supplier({
      name, contactPerson, email, phone, address
    });
    const createdSupplier = await supplier.save();
    res.status(201).json(createdSupplier);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

export default router;