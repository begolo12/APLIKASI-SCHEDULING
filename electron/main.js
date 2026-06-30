const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;
let tray = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0f1117',
    title: 'FlowBoard',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5180');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    console.log(`[Renderer] ${message} (at ${path.basename(sourceId)}:${line})`);
  });

  mainWindow.on('close', (e) => {
    // Minimize to tray instead of quitting (keeps reminders alive)
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  // Use an empty image fallback if icon missing
  let image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  if (image.isEmpty()) {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Buka FlowBoard', click: () => { mainWindow.show(); } },
    { type: 'separator' },
    { label: 'Keluar', click: () => { app.isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip('FlowBoard');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.hide();
    else mainWindow.show();
  });
}

app.whenReady().then(async () => {
  try {
    await require('./ipc').registerIpcHandlers(ipcMain, () => mainWindow);
    createWindow();
    try { createTray(); } catch (e) { console.warn('Tray init failed:', e.message); }
  } catch (err) {
    dialog.showErrorBox(
      'Inisialisasi FlowBoard Gagal',
      err.message || String(err)
    );
    app.isQuitting = true;
    app.quit();
    return;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Keep app alive in tray on Windows; only quit explicitly
  if (process.platform !== 'darwin' && app.isQuitting) {
    app.quit();
  }
});

// Expose a notification helper via IPC
ipcMain.handle('notify', (_e, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({ title: title || 'FlowBoard', body: body || '' }).show();
  }
  return true;
});
