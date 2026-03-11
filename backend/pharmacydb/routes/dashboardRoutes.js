import { logActivity } from '../utils/logActivity.js';
import express from 'express';
import { protect } from '../middleware/authMiddleware.js'; // 'admin' is REMOVED from here
import Inventory from '../models/Inventory.js';
import Sale from '../models/Sale.js';
import Prescription from '../models/Prescription.js';

const router = express.Router();

// @route   GET /api/dashboard/stats
// @desc    Get aggregated stats for Admin & Pharmacist Dashboard
router.get('/stats', protect, async (req, res) => { // 🔥 CRITICAL FIX: 'admin' is REMOVED here!
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const thirtyDaysFromNow = new Date();
        thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

        // 1. INVENTORY STATS
        const inventoryItems = await Inventory.find({ isArchived: false });
        const totalItems = inventoryItems.length;
        const outOfStock = inventoryItems.filter(i => i.quantity === 0).length;
        const lowStock = inventoryItems.filter(i => i.quantity > 0 && i.quantity <= 20).length;
        const expiringSoon = inventoryItems.filter(i => {
            const exp = new Date(i.expiryDate);
            return exp > new Date() && exp <= thirtyDaysFromNow;
        }).length;

        // 2. SALES STATS
        const todaySales = await Sale.find({ createdAt: { $gte: today, $lt: tomorrow } });
        const todayRevenue = todaySales.reduce((sum, sale) => sum + (sale.totalAmount || 0), 0);
        const todayTransactions = todaySales.length;
        const avgTransaction = todayTransactions > 0 ? todayRevenue / todayTransactions : 0;

        // 3. PRESCRIPTION STATS
        const todayPrescriptions = await Prescription.countDocuments({
            status: { $in: ['Dispensed', 'Completed'] },
            updatedAt: { $gte: today, $lt: tomorrow }
        });
        const pendingReview = await Prescription.countDocuments({ status: 'Pending' });
        const readyForPickup = await Prescription.countDocuments({ status: { $in: ['Dispensed', 'Completed'] } });

        // 4. CHART DATA GENERATION
        const salesTrendLabels = [];
        const salesTrendData = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const start = new Date(d.setHours(0,0,0,0));
            const end = new Date(d.setHours(23,59,59,999));
            const daySales = await Sale.aggregate([
                { $match: { createdAt: { $gte: start, $lte: end } } },
                { $group: { _id: null, total: { $sum: "$totalAmount" } } }
            ]);
            salesTrendLabels.push(d.toLocaleDateString('en-US', { weekday: 'short' })); 
            salesTrendData.push(daySales[0]?.total || 0);
        }

        const stockLabels = ["In Stock", "Low Stock", "Out of Stock", "Expiring"];
        const stockData = [
            inventoryItems.filter(i => i.quantity > 20).length, 
            lowStock,
            outOfStock,
            expiringSoon
        ];

        res.json({
            inventory: { totalItems, outOfStock, lowStock, expiringSoon },
            sales: { todayRevenue, todayTransactions, avgTransaction },
            prescriptions: { todayTotal: todayPrescriptions, pendingReview, readyForPickup },
            charts: {
                salesTrend: { labels: salesTrendLabels, data: salesTrendData },
                stockDistribution: { labels: stockLabels, data: stockData }
            }
        });

    } catch (err) {
        console.error("Dashboard Stats Error:", err);
        res.status(500).json({ message: "Server Error" });
    }
});

export default router;