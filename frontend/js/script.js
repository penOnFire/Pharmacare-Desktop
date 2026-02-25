const { ipcRenderer } = require('electron');

    document.getElementById('min-btn').addEventListener('click', () => {
        ipcRenderer.send('minimize-app');
    });

    document.getElementById('max-btn').addEventListener('click', () => {
        ipcRenderer.send('maximize-app');
    });

    document.getElementById('close-btn').addEventListener('click', () => {
        ipcRenderer.send('close-app');
    });