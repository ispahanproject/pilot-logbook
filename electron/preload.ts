import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('logbookAPI', {
  getPages: () => ipcRenderer.invoke('db:getPages'),
  getFlights: (pageId: number) => ipcRenderer.invoke('db:getFlights', pageId),
  createPage: (data: { year: number; month: string; subIndex: number }) =>
    ipcRenderer.invoke('db:createPage', data),
  upsertFlight: (flight: any) => ipcRenderer.invoke('db:upsertFlight', flight),
  getCumulativeBase: () => ipcRenderer.invoke('db:getCumulativeBase'),
  setCumulativeBase: (base: any) => ipcRenderer.invoke('db:setCumulativeBase', base),

  exportDatabase: () => ipcRenderer.invoke('db:export'),
  importDatabase: () => ipcRenderer.invoke('db:import'),
  revealDbInFinder: () => ipcRenderer.invoke('db:revealInFinder'),
  getDbInfo: () => ipcRenderer.invoke('db:getDbInfo'),

  deletePage: (pageId: number) => ipcRenderer.invoke('db:deletePage', pageId),
  deleteMonth: (year: number, month: string) => ipcRenderer.invoke('db:deleteMonth', { year, month }),
  clearAllData: () => ipcRenderer.invoke('db:clearAllData'),

  pickMftrPdf: () => ipcRenderer.invoke('mftr:pickPdf'),
  parseMftrPdf: (filePath: string) => ipcRenderer.invoke('mftr:parsePdf', filePath),
});
