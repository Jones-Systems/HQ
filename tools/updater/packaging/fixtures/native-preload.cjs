'use strict';

require('electron').contextBridge.exposeInMainWorld('syntheticHQ', Object.freeze({ shellMounted: () => require('electron').ipcRenderer.invoke('hq-synthetic-shell-mounted') }));
