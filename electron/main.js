const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { fork } = require("child_process"); // NEW: Import fork to run the backend

let win;
let backendProcess; // NEW: Variable to keep track of the background server
const fs = require("fs");

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    icon: path.join(__dirname, "../frontend/html/images/wellserved.ico"),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.on("maximize", () => {
    win.webContents.send("is-maximized");
  });

  win.on("unmaximize", () => {
    win.webContents.send("is-restored");
  });

  win.loadFile(path.join(__dirname, "../frontend/html/index.html"));
}

// NEW: We changed how app.whenReady is handled so we can start the backend first
app.whenReady().then(() => {
  let backendPath;

  // 1. Check if the app is a compiled .exe or running in development
  if (app.isPackaged) {
    // When packaged as an .exe, look in the special 'unpacked' folder
    backendPath = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "backend",
      "pharmacydb",
      "index.js",
    );
  } else {
    // During development (npm start)
    backendPath = path.join(__dirname, "../backend/pharmacydb/index.js");
  }

  // NEW: Get the exact directory folder of the backend
  const backendDir = path.dirname(backendPath);

  // 2. Start the backend with the correct Working Directory
  backendProcess = fork(backendPath, [], {
    stdio: "pipe",
    cwd: backendDir, // <-- CRITICAL FIX: Forces Node to look for .env in this specific folder
  });

  // 3. Listen for normal logs
  backendProcess.stdout.on("data", (data) => {
    console.log(`Backend Log: ${data}`);
  });

  // 4. Listen for ERRORS and write them to a file so we can debug if it fails
  backendProcess.stderr.on("data", (data) => {
    console.error(`Backend Error: ${data}`);
    if (app.isPackaged) {
      const logPath = path.join(app.getPath("userData"), "backend-error.log");
      fs.appendFileSync(logPath, `Error: ${data}\n`);
    }
  });

  createWindow();
});

// NEW: Crucial step - Kill the backend when the app closes
app.on("will-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

// --- IPC MAIN HANDLERS ---
ipcMain.on("minimize-app", () => {
  if (win) win.minimize();
});

ipcMain.on("maximize-app", () => {
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.on("close-app", () => {
  if (win) win.close();
});

ipcMain.on("check-maximized", (event) => {
  if (win.isMaximized()) {
    event.reply("is-maximized");
  } else {
    event.reply("is-restored");
  }
});
