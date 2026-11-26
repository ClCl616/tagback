const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('operator',{call:(action,input)=>ipcRenderer.invoke('operator:action',action,input)});
