const { ipcRenderer } = require('electron');

// WRAPPER: Wait for the HTML to fully load before running the script
document.addEventListener('DOMContentLoaded', () => {

    // 1. Get Elements
    const minBtn = document.getElementById('min-btn');
    const maxBtn = document.getElementById('max-btn');
    const closeBtn = document.getElementById('close-btn');
    
    // Safety Check: If we are on a page without these buttons, stop here to avoid errors
    if (!minBtn || !maxBtn || !closeBtn) return;

    const maxIcon = maxBtn.querySelector('.material-icons-outlined');

    // 2. Define Actions
    minBtn.addEventListener('click', () => ipcRenderer.send('minimize-app'));
    maxBtn.addEventListener('click', () => ipcRenderer.send('maximize-app'));
    closeBtn.addEventListener('click', () => ipcRenderer.send('close-app'));

    // 3. Define Icon Swap Logic
    const setMaximizedIcon = () => {
        if (maxIcon) maxIcon.innerText = 'content_copy'; // Restore icon
        if (maxBtn) maxBtn.title = "Restore";
    };

    const setRestoredIcon = () => {
        if (maxIcon) maxIcon.innerText = 'crop_square'; // Maximize icon
        if (maxBtn) maxBtn.title = "Maximize";
    };

    // 4. Listen for Main Process replies
    ipcRenderer.on('is-maximized', setMaximizedIcon);
    ipcRenderer.on('is-restored', setRestoredIcon);

    // 5. CRITICAL: Ask for status immediately on load
    // This fixes the "wrong icon" bug when navigating to login.html
    ipcRenderer.send('check-maximized');
});