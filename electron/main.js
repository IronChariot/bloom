import { app, BrowserWindow, Menu, ipcMain, dialog, clipboard } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GraphStore, newGraph, validateGraph, toCanvas, fromCanvas } from '../src/graph.js';
import { startMcp } from './mcp.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.env.BLOOM_TEST_DATA) app.setPath('userData', process.env.BLOOM_TEST_DATA);
let window, store, service, currentPath = null, saved = '', recent = [], viewport = {}, writeQueue = Promise.resolve(), closing = false, agentActivity = null;
const dataPath = name => path.join(app.getPath('userData'), name);
async function atomicWrite(file, text) { const temp = `${file}.tmp`; await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(temp, text); await fs.rename(temp, file); }
const dirty = () => !!store && JSON.stringify(store.graph) !== saved;
const state = () => ({ ...(store?.snapshot() ?? { graph: null, revision: 0, canUndo: false, canRedo: false, activity: [] }), path: currentPath, dirty: dirty(), recent, agentActivity });
function broadcast() {
  if (window && !window.isDestroyed()) { window.webContents.send('board:state', state()); window.setTitle(`${dirty() ? '• ' : ''}${store?.graph.title || 'Bloom'} — Bloom`); }
}
function recover() {
  const value = JSON.stringify({ graph: store?.graph ?? null, currentPath, saved });
  writeQueue = writeQueue.then(() => atomicWrite(dataPath('recovery.json'), value)).catch(e => { window?.webContents.send('board:action', { type: 'error', message: `Recovery save failed: ${e.message}` }); });
}
function attach(graph) { store = new GraphStore(graph, () => { broadcast(); recover(); }); }
async function remember(file) { recent = [file, ...recent.filter(p => p !== file)].slice(0, 8); await atomicWrite(dataPath('recent.json'), JSON.stringify(recent)); }
async function save(as = false) {
  if (!store) return false;
  let file = as ? null : currentPath;
  if (!file) { const result = await dialog.showSaveDialog(window, { defaultPath: `${store.graph.title.replace(/[<>:"/\\|?*]/g, '-')}.bloom`, filters: [{ name: 'Bloom brainstorm', extensions: ['bloom'] }] }); if (result.canceled) return false; file = result.filePath; }
  const text = JSON.stringify(store.graph); await atomicWrite(file, JSON.stringify(store.graph, null, 2)); saved = text; currentPath = file; await remember(file); recover(); broadcast(); return true;
}
async function mayLeave(discardRecovery = false) {
  if (!dirty()) return true;
  const { response } = await dialog.showMessageBox(window, { type: 'question', buttons: ['Save', 'Discard changes', 'Cancel'], defaultId: 0, cancelId: 2, message: `Save changes to “${store.graph.title}”?` });
  if (response === 0) return save();
  if (response === 1 && discardRecovery) { if (saved) attach(validateGraph(JSON.parse(saved))); else store = null; recover(); }
  return response === 1;
}
async function flushEditor() {
  const id = Date.now().toString();
  return new Promise(resolve => {
    const listener = (event, returnedId, ok) => { if (event.sender !== window.webContents || returnedId !== id) return; clearTimeout(timer); ipcMain.removeListener('board:flushed', listener); resolve(ok === true); };
    const timer = setTimeout(() => { ipcMain.removeListener('board:flushed', listener); resolve(false); }, 5000);
    ipcMain.on('board:flushed', listener); window.webContents.send('board:action', { type: 'flush', id });
  });
}
async function command(name, value) {
  if (name === 'undo') { store?.undo(); return; }
  if (name === 'redo') { store?.redo(); return; }
  if (name === 'save') return save();
  if (name === 'saveAs') return save(true);
  if (name === 'new' || name === 'close') { if (!await mayLeave()) return; currentPath = null; if (name === 'new') attach(newGraph()); else store = null; saved = store ? JSON.stringify(store.graph) : ''; recover(); broadcast(); return; }
  if (name === 'open' || name === 'recent') {
    let file;
    if (name === 'recent') { if (!recent.includes(value)) throw new Error('File is not in the recent list.'); file = value; }
    else { const result = await dialog.showOpenDialog(window, { filters: [{ name: 'Brainstorm boards', extensions: ['bloom', 'canvas', 'json'] }], properties: ['openFile'] }); if (result.canceled) return; file = result.filePaths[0]; }
    if ((await fs.stat(file)).size > 10_000_000) throw new Error('Board file is too large (maximum 10 MB).');
    const input = JSON.parse(await fs.readFile(file, 'utf8')); const graph = input.format === 'bloom' ? validateGraph(input) : fromCanvas(input, path.basename(file, path.extname(file)));
    if (!await mayLeave()) return;
    attach(graph); currentPath = input.format === 'bloom' ? file : null; saved = JSON.stringify(graph); await remember(file); recover(); broadcast(); return;
  }
  if (name === 'export') {
    if (!store) return; const result = await dialog.showSaveDialog(window, { defaultPath: `${store.graph.title}.canvas`, filters: [{ name: 'JSON Canvas', extensions: ['canvas'] }] });
    if (!result.canceled) await atomicWrite(result.filePath, JSON.stringify(toCanvas(store.graph), null, 2)); return;
  }
  if (name === 'sessionToggle') { service.setEnabled(value); return service.info(); }
  if (name === 'copySession') { const info = service.info(); clipboard.writeText(JSON.stringify({ mcpServers: { bloom: { url: info.url, headers: { Authorization: `Bearer ${info.token}` } } } }, null, 2)); return; }
  if (name === 'copyNodes') { if (typeof value !== 'string' || value.length > 2_000_000) throw new Error('Clipboard is too large.'); clipboard.writeText(value); return; }
  if (name === 'pasteNodes') return clipboard.readText();
  throw new Error('Unknown command.');
}
async function boot() {
if (!app.requestSingleInstanceLock()) { app.quit(); return; }
app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
await app.whenReady();
try { recent = JSON.parse(await fs.readFile(dataPath('recent.json'), 'utf8')).filter(p => typeof p === 'string'); } catch {}
let recovered = false;
try {
  const recovery = JSON.parse(await fs.readFile(dataPath('recovery.json'), 'utf8'));
  if (recovery.graph) { attach(validateGraph(recovery.graph)); currentPath = recovery.currentPath; saved = recovery.saved; recovered = true; }
  else if (recovery.graph === null) recovered = true;
} catch {}
if (!recovered) { attach(newGraph(true)); saved = JSON.stringify(store.graph); }
window = new BrowserWindow({ width: 1440, height: 960, minWidth: 760, minHeight: 540, backgroundColor: '#fafbfc', title: 'Bloom', autoHideMenuBar: true, show: !process.env.BLOOM_TEST_DATA, webPreferences: { preload: path.join(root, 'electron/preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
window.webContents.session.setPermissionRequestHandler((_, __, callback) => callback(false));
window.webContents.on('will-navigate', e => e.preventDefault());
ipcMain.handle('board:state', () => state());
ipcMain.handle('board:apply', (_, ops, revision) => { if (!store) throw new Error('No board is open.'); store.apply(ops, 'You', revision); return state(); });
ipcMain.handle('board:command', async (_, name, value) => command(name, value));
ipcMain.handle('session:info', () => service?.info() ?? { enabled: false });
ipcMain.on('board:viewport', (_, value) => { if (value && ['x', 'y', 'zoom', 'width', 'height'].every(k => Number.isFinite(value[k]))) viewport = value; });
service = await startMcp({ getStore: () => store, getViewport: () => viewport, screenshot: async () => {
  const size = window.getContentSize(); return (await window.webContents.capturePage({ x: 0, y: 76, width: size[0], height: Math.max(1, size[1] - 76) })).toPNG().toString('base64');
}, onActivity: message => { agentActivity = { message, at: Date.now() }; window.webContents.send('session:activity', agentActivity); } });
const menuCommand = name => () => window.webContents.send('board:action', { type: 'command', name });
Menu.setApplicationMenu(Menu.buildFromTemplate([
  { label: 'File', submenu: [{ label: 'New board', accelerator: 'CmdOrCtrl+N', click: menuCommand('new') }, { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: menuCommand('open') }, { label: 'Save', accelerator: 'CmdOrCtrl+S', click: menuCommand('save') }, { label: 'Save as…', accelerator: 'CmdOrCtrl+Shift+S', click: menuCommand('saveAs') }, { label: 'Export JSON Canvas…', click: menuCommand('export') }, { type: 'separator' }, { label: 'Close board', accelerator: 'CmdOrCtrl+W', click: menuCommand('close') }, { role: 'quit' }] },
  { label: 'Edit', submenu: [{ label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: () => window.webContents.send('board:action', { type: 'undo' }) }, { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', click: () => window.webContents.send('board:action', { type: 'redo' }) }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
  { label: 'View', submenu: [{ role: 'togglefullscreen' }, { role: 'toggleDevTools' }] }
]));
await window.loadFile(path.join(root, 'index.html'));
window.on('close', e => { if (closing) return; e.preventDefault(); void (async () => { if (await flushEditor() && await mayLeave(true)) { await writeQueue; closing = true; service.close(); window.close(); } })(); });
app.on('window-all-closed', () => app.quit());
}
void boot().catch(error => { console.error(error); app.exit(1); });
