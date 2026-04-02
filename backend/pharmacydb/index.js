import activityRoutes from './routes/activityRoutes.js';
import express from 'express';
import dotenv from 'dotenv';
import { connectDB } from './config/db.js';
import patientRoutes from './routes/patientRoutes.js';
import inventoryRoutes from './routes/inventoryRoutes.js';
import medicineRoutes from './routes/medicineRoutes.js';
import userRoutes from './routes/userRoutes.js';
import prescriptionRoutes from './routes/prescriptionRoutes.js';
import saleRoutes from './routes/saleRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import supplierRoutes from './routes/supplierRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import settingsRoutes from './routes/settingsRoutes.js';
import externalRoutes from './routes/externalRoutes.js';
import reportRoutes from './routes/reportRoutes.js';
import dispenseRoutes from './routes/dispenseRoutes.js';

import cors from 'cors';

// Load environment variables from .env file
dotenv.config();

// Connect to the database
connectDB();

// Initialize the app
const app = express();

// Middleware to parse JSON bodies
app.use(cors());
app.use(express.json());

// routes
app.use('/api/activity', activityRoutes);
app.use('/api/patients', patientRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/medicines', medicineRoutes);
app.use('/api/users', userRoutes);
app.use('/api/prescriptions', prescriptionRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/external', externalRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dispense', dispenseRoutes);
// A simple route to test if the server is working
app.get('/', (req, res) => {
  res.send('Pharmacy API is running... 💊');
});

const PORT = process.env.PORT || 5001;

app.listen(PORT, "0.0.0.0", () => console.log(`Server started on port ${PORT}`));
