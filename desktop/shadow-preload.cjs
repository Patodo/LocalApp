const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("localAppShadows", {
  list: () => ipcRenderer.invoke("localapp:shadows:list"),
  add: (peerId, name) => ipcRenderer.invoke("localapp:shadows:add", peerId, name),
  open: id => ipcRenderer.invoke("localapp:shadows:open", id),
});
