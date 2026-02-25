import express from 'express';
import Medicine from '../models/Medicine.js';
import Inventory from '../models/Inventory.js';
import { checkIntegrationEnabled, verifyApiKey } from '../middleware/integrationMiddleware.js';

const router = express.Router();

// ==================================================================
// EXTERNAL API FOR EMR
// Access: Requires API Key + Integration Toggle ON
// ==================================================================

// 1. EMR wants to get list of Medicines
router.get('/medicines', verifyApiKey, checkIntegrationEnabled, async (req, res) => {
    try {
        // Give them what they need (Name, Strength, Stock)
        // We aggregate inventory to show total stock per medicine
        const inventory = await Inventory.find({ isArchived: false }).populate('medicine');
        const validInventory = inventory.filter(item => item.medicine != null);
        const stockList = validInventory.map(item => ({
        medicineId: item.medicine._id,
        name: item.medicine.name,
        strength: item.medicine.strength,
        quantity: item.quantity,
        price: item.sellingPrice
    }));

        res.json(stockList);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

export default router;