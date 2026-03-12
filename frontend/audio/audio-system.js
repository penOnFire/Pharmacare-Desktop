// audio-system.js

// 1. Create a library of sounds
const soundLibrary = {
    default: new Audio('../audio/click.mp3'),
    success: new Audio('../audio/success.mp3'), 
    error: new Audio('../audio/error.mp3'),
    delete: new Audio('../audio/update.mp3'),
    update: new Audio('../audio/update.wav'),
    notification: new Audio('../audio/notification.mp3') // <-- ADD THIS LINE
};
// Set volume and preload all sounds
for (let key in soundLibrary) {
    soundLibrary[key].volume = 0.4;
    soundLibrary[key].load();
}

// 2. The Global Event Listener for Clicks
document.addEventListener('click', function(event) {
    const clickableElement = event.target.closest('button, a');

    if (clickableElement) {
        // Figure out WHICH sound to play based on data-sound attribute
        const soundType = clickableElement.getAttribute('data-sound') || 'default';
        const audioToPlay = soundLibrary[soundType];

        if (audioToPlay) {
            audioToPlay.currentTime = 0;
            audioToPlay.play().catch(err => console.warn("Audio blocked:", err));
        }

        // Link Navigation Fix
        const linkElement = event.target.closest('a');
        if (linkElement && linkElement.href && !linkElement.href.includes('#')) {
            event.preventDefault(); 
            setTimeout(() => {
                window.location.href = linkElement.href;
            }, 200); 
        }
    }
}); // <-- Click listener safely closes here!

// 3. GLOBAL System Sound Function (Available to all your other scripts!)
window.playSystemSound = function(soundType) {
    const audioToPlay = soundLibrary[soundType];
    if (audioToPlay) {
        audioToPlay.currentTime = 0;
        audioToPlay.play().catch(err => console.warn("Audio blocked:", err));
    }
};