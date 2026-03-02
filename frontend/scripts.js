// Script Manager Dashboard JavaScript
// Full CRUD operations for bot scripts with S3 storage

const API_BASE = '/api';
let scripts = [];
let activeScriptId = null;
let currentScriptId = null;

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    loadScripts();
});

// ═══════════════════════════════════════════════════════════════
// LOAD SCRIPTS
// ═══════════════════════════════════════════════════════════════

async function loadScripts() {
    try {
        const response = await fetch(`${API_BASE}/scripts`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = await response.json();
        scripts = data.scripts || [];
        activeScriptId = data.active_script_id;

        renderScriptsList();

        // Auto-select active script if none selected
        if (!currentScriptId && activeScriptId) {
            selectScript(activeScriptId);
        }

    } catch (error) {
        console.error('[Scripts] Load error:', error);
        showStatus('Failed to load scripts: ' + error.message, 'error');
    }
}

function renderScriptsList() {
    const container = document.getElementById('scripts-list');

    if (scripts.length === 0) {
        container.innerHTML = '<div class="no-scripts">No scripts yet. Click "+ New Script" to create one.</div>';
        return;
    }

    container.innerHTML = '';
    scripts.forEach(script => {
        const isActive = script.id === activeScriptId;
        const isSelected = script.id === currentScriptId;

        const card = document.createElement('div');
        card.className = `script-card${isActive ? ' active-script' : ''}${isSelected ? ' selected' : ''}`;
        card.onclick = () => selectScript(script.id);

        const updatedAt = script.updated_at
            ? new Date(script.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : '';

        card.innerHTML = `
            <div class="script-card-name">
                ${escapeHtml(script.name)}
                ${isActive ? '<span class="active-badge">LIVE</span>' : ''}
            </div>
            <div class="script-card-meta">
                ${script.end_goal ? escapeHtml(script.end_goal.substring(0, 50)) + (script.end_goal.length > 50 ? '...' : '') : 'No end goal set'}
                ${updatedAt ? ' • ' + updatedAt : ''}
            </div>
        `;
        container.appendChild(card);
    });
}

// ═══════════════════════════════════════════════════════════════
// SELECT / EDIT SCRIPT
// ═══════════════════════════════════════════════════════════════

function selectScript(scriptId) {
    const script = scripts.find(s => s.id === scriptId);
    if (!script) return;

    currentScriptId = scriptId;

    // Show editor, hide empty state
    document.getElementById('editor-empty').style.display = 'none';
    document.getElementById('editor-form').style.display = 'block';

    // Populate fields
    document.getElementById('script-id').value = script.id;
    document.getElementById('script-name').value = script.name || '';
    document.getElementById('script-end-goal').value = script.end_goal || '';
    document.getElementById('script-opener').value = script.opener || '';
    document.getElementById('script-logic').value = script.logic || '';
    document.getElementById('script-system-prompt').value = script.system_prompt || '';

    // Update header
    document.getElementById('editor-title').textContent = script.name || 'Edit Script';

    // Show/hide active badge
    const isActive = script.id === activeScriptId;
    document.getElementById('editor-active-badge').style.display = isActive ? 'inline-block' : 'none';

    // Update activate button
    const activateBtn = document.getElementById('btn-activate');
    if (isActive) {
        activateBtn.textContent = 'Currently Active';
        activateBtn.className = 'btn-activate already-active';
        activateBtn.onclick = null;
    } else {
        activateBtn.textContent = 'Activate Script';
        activateBtn.className = 'btn-activate';
        activateBtn.onclick = activateScript;
    }

    // Update delete button (can't delete active)
    document.getElementById('btn-delete').disabled = isActive;

    // Highlight in sidebar
    renderScriptsList();
}

// ═══════════════════════════════════════════════════════════════
// NEW SCRIPT
// ═══════════════════════════════════════════════════════════════

function newScript() {
    currentScriptId = null;

    document.getElementById('editor-empty').style.display = 'none';
    document.getElementById('editor-form').style.display = 'block';

    // Clear all fields
    document.getElementById('script-id').value = '';
    document.getElementById('script-name').value = '';
    document.getElementById('script-end-goal').value = '';
    document.getElementById('script-opener').value = '';
    document.getElementById('script-logic').value = '';
    document.getElementById('script-system-prompt').value = '';

    document.getElementById('editor-title').textContent = 'New Script';
    document.getElementById('editor-active-badge').style.display = 'none';

    const activateBtn = document.getElementById('btn-activate');
    activateBtn.textContent = 'Activate Script';
    activateBtn.className = 'btn-activate';
    activateBtn.onclick = activateScript;

    document.getElementById('btn-delete').disabled = true;

    // Deselect in sidebar
    renderScriptsList();

    // Focus name field
    document.getElementById('script-name').focus();
}

// ═══════════════════════════════════════════════════════════════
// SAVE SCRIPT
// ═══════════════════════════════════════════════════════════════

async function saveScript() {
    const name = document.getElementById('script-name').value.trim();
    const opener = document.getElementById('script-opener').value.trim();

    if (!name) {
        showStatus('Script name is required', 'error');
        document.getElementById('script-name').focus();
        return;
    }
    if (!opener) {
        showStatus('Opening line is required', 'error');
        document.getElementById('script-opener').focus();
        return;
    }

    const payload = {
        name: name,
        end_goal: document.getElementById('script-end-goal').value.trim(),
        opener: opener,
        logic: document.getElementById('script-logic').value.trim(),
        system_prompt: document.getElementById('script-system-prompt').value.trim()
    };

    // Include ID if editing existing
    const scriptId = document.getElementById('script-id').value;
    if (scriptId) {
        payload.id = scriptId;
    }

    try {
        showStatus('Saving...', 'info');

        const response = await fetch(`${API_BASE}/scripts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Save failed');
        }

        const result = await response.json();
        showStatus(result.message, 'success');

        // Update current script ID
        currentScriptId = result.script.id;
        document.getElementById('script-id').value = result.script.id;

        // Reload list
        await loadScripts();
        selectScript(currentScriptId);

    } catch (error) {
        console.error('[Scripts] Save error:', error);
        showStatus('Failed to save: ' + error.message, 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// SAVE AS NEW
// ═══════════════════════════════════════════════════════════════

async function saveAsNew() {
    const name = document.getElementById('script-name').value.trim();
    if (!name) {
        showStatus('Script name is required', 'error');
        return;
    }

    // Clear the ID so it creates a new one
    document.getElementById('script-id').value = '';
    document.getElementById('script-name').value = name + ' (Copy)';

    await saveScript();
}

// ═══════════════════════════════════════════════════════════════
// ACTIVATE SCRIPT
// ═══════════════════════════════════════════════════════════════

async function activateScript() {
    const scriptId = document.getElementById('script-id').value;
    if (!scriptId) {
        // Save first, then activate
        showStatus('Save the script first before activating', 'error');
        return;
    }

    if (scriptId === activeScriptId) {
        showStatus('This script is already active', 'info');
        return;
    }

    if (!confirm('Activate this script? The server will restart to apply changes.')) return;

    try {
        showStatus('Activating...', 'info');

        const response = await fetch(`${API_BASE}/scripts/${scriptId}/activate`, {
            method: 'POST'
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Activation failed');
        }

        const result = await response.json();
        activeScriptId = scriptId;

        // Show restart countdown
        let seconds = 5;
        const countdown = setInterval(() => {
            if (seconds > 0) {
                showStatus(`Server restarting... ${seconds}s`, 'info');
                seconds--;
            } else {
                clearInterval(countdown);
                showStatus('Waiting for server...', 'info');
                setTimeout(() => {
                    showStatus('Script activated! Reloading...', 'success');
                    setTimeout(() => loadScripts(), 1000);
                }, 3000);
            }
        }, 1000);

    } catch (error) {
        console.error('[Scripts] Activate error:', error);
        showStatus('Activation failed: ' + error.message, 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// DELETE SCRIPT
// ═══════════════════════════════════════════════════════════════

async function deleteScript() {
    const scriptId = document.getElementById('script-id').value;
    if (!scriptId) return;

    if (scriptId === activeScriptId) {
        showStatus('Cannot delete the active script', 'error');
        return;
    }

    const scriptName = document.getElementById('script-name').value;
    if (!confirm(`Delete "${scriptName}"? This cannot be undone.`)) return;

    try {
        showStatus('Deleting...', 'info');

        const response = await fetch(`${API_BASE}/scripts/${scriptId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Delete failed');
        }

        showStatus('Script deleted', 'success');
        currentScriptId = null;

        // Show empty state
        document.getElementById('editor-form').style.display = 'none';
        document.getElementById('editor-empty').style.display = 'flex';

        await loadScripts();

    } catch (error) {
        console.error('[Scripts] Delete error:', error);
        showStatus('Delete failed: ' + error.message, 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════════════════════════

function showStatus(message, type) {
    const el = document.getElementById('script-status');
    el.textContent = message;
    el.className = `script-status ${type}`;
    el.classList.remove('hidden');

    if (type === 'success') {
        setTimeout(() => el.classList.add('hidden'), 4000);
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Toast notification (copied from main dashboard)
function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icons = { success: '', error: '', warning: '', info: '' };
    toast.innerHTML = `<span class="toast-text">${message}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
