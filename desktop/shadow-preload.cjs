const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localAppShadows", {
  list: () => ipcRenderer.invoke("localapp:shadows:list"),
  open: id => ipcRenderer.invoke("localapp:shadows:open", id),
});
