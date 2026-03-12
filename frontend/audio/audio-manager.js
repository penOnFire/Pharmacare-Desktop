/**
 * Pharmacy System - Audio Manager
 * Centralized Web Audio API controller for the Electron desktop app.
 */

const AudioManager = {
    // 1. Store the audio context so it is created only once
    context: null,

    // 2. Safely get or create the audio environment
    getContext: function() {
        if (!this.context) {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
        }
        return this.context;
    },

    // 3. PM's Global Notification Sound
    playNotificationSound: function() {
        try {
            const audioCtx = this.getContext();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.frequency.value = 800; 
            oscillator.type = 'sine';
            gainNode.gain.value = 0.3;        

            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.2); 
        } catch (err) {
            console.log("Audio not available:", err);
        }
    },

    // 4. Subtle Button Click Sound
    playClickSound: function() {
        try {
            const audioCtx = this.getContext();
            const oscillator = audioCtx.createOscillator();
            const gainNode = audioCtx.createGain();

            oscillator.connect(gainNode);
            gainNode.connect(audioCtx.destination);

            oscillator.frequency.value = 400; 
            oscillator.type = 'sine';
            gainNode.gain.value = 0.1;        

            oscillator.start(audioCtx.currentTime);
            oscillator.stop(audioCtx.currentTime + 0.05); 
        } catch (err) {
            console.log("Audio not available:", err);
        }
    },

    // 5. Automatically attach clicks to all buttons on the page
    initializeClicks: function() {
        // Wait for the HTML to fully load before looking for buttons
        document.addEventListener('DOMContentLoaded', () => {
            const buttons = document.querySelectorAll('button');
            buttons.forEach(button => {
                button.addEventListener('click', () => this.playClickSound());
            });
        });
    }
};

// 6. Initialize the button clicks immediately
AudioManager.initializeClicks();