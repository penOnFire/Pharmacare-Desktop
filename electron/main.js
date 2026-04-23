const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const { fork } = require("child_process"); // Use fork instead of spawn

let win;
let backendProcess;

const isDev = !app.isPackaged;

// ✅ Start backend
function startBackend() {
  // 1. Correct Path Resolution (Make sure it uses app.asar.unpacked in production)
  const backendPath = isDev
    ? path.join(__dirname, "../backend/pharmacydb/index.js")
    : path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "backend",
        "pharmacydb",
        "index.js",
      );

  console.log("Starting backend from:", backendPath);

  // 2. Get the directory to set the Working Directory
  const backendDir = path.dirname(backendPath);

  // 3. Use fork (uses Electron's internal Node) + set the cwd!
  backendProcess = fork(backendPath, [], {
    cwd: backendDir, // 🔥 CRITICAL: Tells Node to look for .env in the pharmacydb folder
    stdio: "pipe",
  });

  backendProcess.stdout.on("data", (data) => {
    console.log(`Backend Log: ${data}`);
  });

  backendProcess.stderr.on("data", (data) => {
    console.error(`Backend Error: ${data}`);
  });

  backendProcess.on("close", (code) => {
    console.log(`Backend process exited with code ${code}`);
  });
}

// ✅ Create window
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

  win.loadFile(path.join(__dirname, "../frontend/html/login.html"));
}

// ✅ Start everything
app.whenReady().then(() => {
  startBackend(); // 🔥 AUTO START BACKEND
  createWindow();
});

// ✅ Kill backend when app closes
app.on("will-quit", () => {
  if (backendProcess) {
    backendProcess.kill();
  }
});

// ================= IPC HANDLERS =================

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
  if (win && win.isMaximized()) {
    event.reply("is-maximized");
  } else {
    event.reply("is-restored");
  }
});
