const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// CHANGE 1: Declare 'win' here (outside the function)
let win;

function createWindow() {
  // CHANGE 2: Remove 'const' or 'let' here.
  // We want to use the 'win' variable we created above.
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    con: path.join(__dirname, "../frontend/html/images/wellserved.png"),
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

app.whenReady().then(createWindow);

// Now these will work because they can access 'win'
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

// main.js - Add this with your other ipcMain handlers
ipcMain.on("check-maximized", (event) => {
  if (win.isMaximized()) {
    event.reply("is-maximized");
  } else {
    event.reply("is-restored");
  }
});
