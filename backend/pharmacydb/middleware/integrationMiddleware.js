import SystemSettings from '../models/SystemSettings.js';

// Middleware to check if EMR integration is globally enabled
export const checkIntegrationEnabled = async (req, res, next) => {
  try {
    // 1. Fetch the settings from your database
    const settings = await SystemSettings.findOne();

    // 2. Check if the switch is OFF
    if (!settings || !settings.emr.enabled) {
      console.log(`🚫 Blocked external access: EMR Integration is disabled.`);
      return res.status(503).json({ 
        message: 'Service Unavailable: Pharmacy integration is currently disabled by Admin.' 
      });
    }

    // 3. If ON, let the request pass
    next();
  } catch (error) {
    console.error("Integration Check Error:", error);
    res.status(500).json({ message: "Server Error during integration check" });
  }
};

// Middleware to verify the API Key (Security)
export const verifyApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  // Make sure PHARMACY_API_KEY matches what is in your .env file
  const validKey = process.env.PHARMACY_API_KEY; 

  if (apiKey && apiKey === validKey) {
    next();
  } else {
    console.log(`🚫 Blocked external access: Invalid API Key.`);
    res.status(401).json({ message: 'Unauthorized: Invalid API Key' });
  }
};