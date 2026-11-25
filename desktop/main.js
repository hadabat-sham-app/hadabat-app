const { app, BrowserWindow, Menu, shell } = require('electron');
const URL = 'https://hadabat-sham-app.github.io/hadabat-app/';
let win;
function create() {
  win = new BrowserWindow({ width: 1280, height: 800, minWidth: 420, minHeight: 600, title: 'هضبة الشام', icon: __dirname + '/icon.png', backgroundColor: '#6b2610', autoHideMenuBar: true, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  Menu.setApplicationMenu(null);
  win.loadURL(URL);
  win.webContents.on('did-fail-load', (e, code, d, u, main) => { if (main) win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent("<html dir='rtl' style='font-family:Segoe UI,Tahoma,sans-serif;background:#f6f1ea;text-align:center;padding:60px'><h2 style='color:#8a3515'>هضبة الشام</h2><p>تعذر الاتصال بالإنترنت</p><button style='padding:12px 28px;font-size:18px;border:0;border-radius:10px;background:#8a3515;color:#fff;cursor:pointer' onclick=\"location.href='" + URL + "'\">إعادة المحاولة</button></html>")); });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.session.on('will-download', (e, item) => {});
}
const lock = app.requestSingleInstanceLock();
if (!lock) app.quit(); else { app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } }); app.whenReady().then(create); app.on('window-all-closed', () => app.quit()); }
