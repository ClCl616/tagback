const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('tagbackKioskHost', {
  version:2, platform:'windows', capabilities:{transport:1},
  request: request => ipcRenderer.invoke('kiosk:request', request),
  reader: { subscribe(listener, options) {
    let active=true;
    const receive=(_event, event)=>{
      if(!active) return;
      if(event.type==='TAG_READ') listener({uid:event.uid,proof:{uid:event.uid,bridgeId:event.bridgeId,issuedAt:event.issuedAt,nonce:event.nonce,signature:event.signature}});
      if(event.type==='TAG_REMOVED') options?.onRemoved?.();
      if(event.type==='READER_CONNECTED') options?.onStatus?.('connected');
      if(event.type==='READER_DISCONNECTED') options?.onStatus?.('disconnected');
    };
    options?.onStatus?.('connecting');
    ipcRenderer.on('kiosk:reader',receive);
    ipcRenderer.invoke('kiosk:reader-status').then(status=>{if(active) options?.onStatus?.(status);}).catch(()=>{if(active) options?.onStatus?.('disconnected');});
    return ()=>{active=false;ipcRenderer.removeListener('kiosk:reader',receive);};
  } },
});
