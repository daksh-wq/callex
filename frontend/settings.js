// Settings Dashboard JavaScript
// Handles loading, updating, and saving bot configuration

// Load current settings from API with retry logic
async function loadSettings(retryCount = 0) {
    const maxRetries = 5;
    const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 5000); // Exponential backoff, max 5s

    try {
        if (retryCount === 0) {
            showStatus('Loading settings...', 'info');
        } else {
            showStatus(`Loading settings... (retry ${retryCount}/${maxRetries})`, 'info');
        }

        const response = await fetch('/api/settings', {
            method: 'GET',
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const config = await response.json();
        console.log('[Settings] Loaded config:', config);

        // Populate VAD settings
        document.getElementById('silence_timeout').value = config.vad.silence_timeout;
        document.getElementById('min_speech_duration').value = config.vad.min_speech_duration;
        document.getElementById('interruption_threshold_db').value = config.vad.interruption_threshold_db;
        document.getElementById('noise_gate_db').value = config.vad.noise_gate_db;

        // Populate voice settings
        document.getElementById('speed').value = config.voice.speed;
        document.getElementById('stability').value = config.voice.stability;
        document.getElementById('similarity_boost').value = config.voice.similarity_boost;
        document.getElementById('style').value = config.voice.style;

        // Populate API credentials
        document.getElementById('server_key').value = config.api_credentials.server_key;
        document.getElementById('secret_key').value = config.api_credentials.secret_key;
        document.getElementById('voice_id').value = config.api_credentials.voice_id;

        // Update value displays
        updateValueDisplays();

        showStatus('Settings loaded successfully', 'success');
        setTimeout(() => {
            document.getElementById('status-message').classList.add('hidden');
        }, 2000);

    } catch (error) {
        console.error('[Settings] Load error:', error);

        // Retry if server is still restarting
        if (retryCount < maxRetries) {
            console.log(`[Settings] Retrying in ${retryDelay}ms...`);
            setTimeout(() => loadSettings(retryCount + 1), retryDelay);
        } else {
            showStatus('Failed to load settings after multiple retries. Please refresh the page.', 'error');
        }
    }
}

// Update value displays for range inputs
function updateValueDisplays() {
    // VAD settings
    document.getElementById('silence_timeout_val').textContent =
        parseFloat(document.getElementById('silence_timeout').value).toFixed(1) + 's';
    document.getElementById('min_speech_duration_val').textContent =
        parseFloat(document.getElementById('min_speech_duration').value).toFixed(2) + 's';
    document.getElementById('interruption_threshold_db_val').textContent =
        parseInt(document.getElementById('interruption_threshold_db').value) + ' dB';
    document.getElementById('noise_gate_db_val').textContent =
        parseInt(document.getElementById('noise_gate_db').value) + ' dB';

    // Voice settings
    document.getElementById('speed_val').textContent =
        parseFloat(document.getElementById('speed').value).toFixed(1) + 'x';
    document.getElementById('stability_val').textContent =
        parseFloat(document.getElementById('stability').value).toFixed(2);
    document.getElementById('similarity_boost_val').textContent =
        parseFloat(document.getElementById('similarity_boost').value).toFixed(2);
    document.getElementById('style_val').textContent =
        parseFloat(document.getElementById('style').value).toFixed(2);
}

// Save settings to API
document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        showStatus('Saving settings...', 'info');

        // Build update object from form
        const updates = {
            vad: {
                silence_timeout: parseFloat(document.getElementById('silence_timeout').value),
                min_speech_duration: parseFloat(document.getElementById('min_speech_duration').value),
                interruption_threshold_db: parseFloat(document.getElementById('interruption_threshold_db').value),
                noise_gate_db: parseFloat(document.getElementById('noise_gate_db').value),
                spectral_flatness_threshold: 0.75  // Keep existing value
            },
            voice: {
                speed: parseFloat(document.getElementById('speed').value),
                stability: parseFloat(document.getElementById('stability').value),
                similarity_boost: parseFloat(document.getElementById('similarity_boost').value),
                style: parseFloat(document.getElementById('style').value),
                use_speaker_boost: true
            },
            api_credentials: {
                server_key: document.getElementById('server_key').value.trim(),
                secret_key: document.getElementById('secret_key').value.trim(),
                voice_id: document.getElementById('voice_id').value.trim()
            }
        };

        console.log('[Settings] Saving:', updates);

        const response = await fetch('/api/settings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to save settings');
        }

        const result = await response.json();
        console.log('[Settings] Save result:', result);

        showStatus(result.message, 'success');

        // Show restart countdown
        let seconds = 5;
        const countdown = setInterval(() => {
            if (seconds > 0) {
                showStatus(`Server restarting... ${seconds}s`, 'info');
                seconds--;
            } else {
                clearInterval(countdown);
                showStatus('Waiting for server to be ready...', 'info');

                // Wait longer before reloading to ensure server is fully up
                setTimeout(() => {
                    showStatus('Server restarted! Reloading settings...', 'info');
                    loadSettings(); // This will retry if server isn't ready
                }, 3000);
            }
        }, 1000);

    } catch (error) {
        console.error('[Settings] Save error:', error);
        showStatus('Failed to save: ' + error.message, 'error');
    }
});

// Show status message with type
function showStatus(message, type) {
    const statusEl = document.getElementById('status-message');
    statusEl.textContent = message;
    statusEl.className = `status-message ${type}`;
    statusEl.classList.remove('hidden');

    // Auto-hide success messages after 5 seconds
    if (type === 'success' && !message.includes('restarted')) {
        setTimeout(() => {
            statusEl.classList.add('hidden');
        }, 5000);
    }
}

// Real-time value display updates for range sliders
document.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('input', updateValueDisplays);
});

// Load settings on page load
document.addEventListener('DOMContentLoaded', () => {
    console.log('[Settings] Page loaded, fetching current settings...');
    loadSettings();
});
