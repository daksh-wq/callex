// Production Dashboard - Main JavaScript
// Full-featured call management with download, export, bulk actions, health monitoring

const API_BASE = '/api';
let currentPage = 0;
const pageSize = 50;
let filters = {};
let selectedCalls = new Set();
let autoRefreshEnabled = true;
let autoRefreshInterval = null;
let currentDetailCallId = null;

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    loadAnalytics();
    loadCalls();
    loadCharts();
    loadTodayStats();
    checkServerHealth();
    setupEventListeners();
    startAutoRefresh();
});

function setupEventListeners() {
    document.getElementById('apply-filters').addEventListener('click', applyFilters);
    document.getElementById('reset-filters').addEventListener('click', resetFilters);
    document.getElementById('prev-page').addEventListener('click', () => changePage(-1));
    document.getElementById('next-page').addEventListener('click', () => changePage(1));

    // Modal close
    document.querySelectorAll('.close').forEach(btn => {
        btn.addEventListener('click', closeModal);
    });

    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) closeModal();
    });

    // API Modal
    document.getElementById('apiBtn').addEventListener('click', openApiModal);

    // Auto-refresh toggle
    document.getElementById('auto-refresh-toggle').addEventListener('change', (e) => {
        autoRefreshEnabled = e.target.checked;
        if (autoRefreshEnabled) {
            startAutoRefresh();
            showToast('Auto-refresh enabled', 'info');
        } else {
            stopAutoRefresh();
            showToast('Auto-refresh paused', 'warning');
        }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeModal();
        if (e.key === 'r' && !e.ctrlKey && !e.metaKey && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            e.preventDefault();
            refreshAll();
            showToast('Dashboard refreshed', 'info');
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// AUTO-REFRESH & HEALTH MONITORING
// ═══════════════════════════════════════════════════════════════

function startAutoRefresh() {
    if (autoRefreshInterval) clearInterval(autoRefreshInterval);
    autoRefreshInterval = setInterval(() => {
        if (autoRefreshEnabled) {
            loadAnalytics();
            loadTodayStats();
            checkServerHealth();
            if (currentPage === 0) loadCalls();
        }
    }, 30000);
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

function refreshAll() {
    loadAnalytics();
    loadCalls();
    loadCharts();
    loadTodayStats();
    checkServerHealth();
}

async function checkServerHealth() {
    try {
        const response = await fetch('/health');
        const data = await response.json();

        const dot = document.getElementById('server-dot');
        const statusText = document.getElementById('server-status');

        if (data.status === 'online' || data.status === 'healthy') {
            dot.classList.add('connected');
            statusText.textContent = 'Online';
        } else {
            dot.classList.remove('connected');
            statusText.textContent = 'Degraded';
        }

        document.getElementById('active-calls').textContent = `${data.active_calls || 0} Active`;
        document.getElementById('server-uptime').textContent = data.uptime || '--';
        document.getElementById('memory-usage').textContent = data.memory_mb ? `${data.memory_mb} MB` : '-- MB';
        document.getElementById('last-refresh').textContent = new Date().toLocaleTimeString('en-IN');

    } catch (error) {
        document.getElementById('server-dot').classList.remove('connected');
        document.getElementById('server-status').textContent = 'Offline';
    }
}

// ═══════════════════════════════════════════════════════════════
// TODAY'S STATS
// ═══════════════════════════════════════════════════════════════

async function loadTodayStats() {
    try {
        const response = await fetch(`${API_BASE}/analytics/today`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        document.getElementById('today-calls').textContent = data.today_calls ?? '0';
        document.getElementById('today-agreed').textContent = data.today_agreed ?? '0';
        document.getElementById('today-rate').textContent = `${data.today_rate ?? 0}%`;
        document.getElementById('today-avg-dur').textContent = `${data.today_avg_duration ?? 0}s`;
    } catch (error) {
        console.error('Error loading today stats:', error);
        document.getElementById('today-calls').textContent = '0';
        document.getElementById('today-agreed').textContent = '0';
        document.getElementById('today-rate').textContent = '0%';
        document.getElementById('today-avg-dur').textContent = '0s';
    }
}

// ═══════════════════════════════════════════════════════════════
// ANALYTICS & API MODAL
// ═══════════════════════════════════════════════════════════════

function openApiModal() {
    const modal = document.getElementById('apiModal');
    const host = window.location.host;
    const protocol = window.location.protocol;
    const baseUrl = `${protocol}//${host}/api`;

    document.getElementById('apiBaseUrl').textContent = baseUrl;
    document.getElementById('apiCallsUrl').textContent = `GET ${baseUrl}/calls?limit=100`;
    document.getElementById('apiStatsUrl').textContent = `GET ${baseUrl}/analytics/summary`;
    document.getElementById('apiRecordingUrl').textContent = `GET ${baseUrl}/calls/{id}/recording`;
    document.getElementById('apiExportUrl').textContent = `GET ${baseUrl}/calls/export/csv`;

    modal.style.display = 'block';
}

function copyToClipboard(elementId) {
    const text = document.getElementById(elementId).textContent.replace('GET ', '');
    navigator.clipboard.writeText(text).then(() => {
        const btn = document.querySelector(`button[onclick="copyToClipboard('${elementId}')"]`);
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.style.background = '#4ade80';
        btn.style.color = '#000';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.background = '';
            btn.style.color = '';
        }, 1500);
    });
}

async function loadAnalytics() {
    try {
        const params = new URLSearchParams(filters);
        const response = await fetch(`${API_BASE}/analytics/summary?${params}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        document.getElementById('total-calls').innerText = data.total_calls ?? 0;
        document.getElementById('agreement-rate').innerText = `${data.agreement_percentage ?? 0}%`;
        document.getElementById('avg-duration').innerText = `${Math.round(data.avg_call_duration ?? 0)}s`;
        document.getElementById('storage-size').innerText = `${data.total_recording_size_mb ?? 0} MB`;
    } catch (error) {
        console.error('Error loading analytics:', error);
    }
}

// ═══════════════════════════════════════════════════════════════
// CALLS TABLE
// ═══════════════════════════════════════════════════════════════

async function loadCalls() {
    try {
        if (currentPage === 0) showLoading();
        const params = new URLSearchParams({
            skip: currentPage * pageSize,
            limit: pageSize,
            ...filters
        });

        const response = await fetch(`${API_BASE}/calls?${params}`);
        const calls = await response.json();

        renderCallsTable(calls);
        updatePagination();
        hideLoading();

        // Update table info
        document.getElementById('table-info').textContent = `Showing ${calls.length} calls (Page ${currentPage + 1})`;

    } catch (error) {
        console.error('Error loading calls:', error);
        hideLoading();
    }
}

function renderCallsTable(calls) {
    const tbody = document.getElementById('calls-tbody');
    tbody.innerHTML = '';

    if (calls.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 40px;">No calls found</td></tr>';
        return;
    }

    calls.forEach(call => {
        const row = document.createElement('tr');
        row.id = `call-row-${call.id}`;
        if (selectedCalls.has(call.id)) row.classList.add('selected-row');

        const date = new Date(call.start_time);
        const dateStr = date.toLocaleString('en-IN', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        const duration = call.duration_seconds ? `${Math.round(call.duration_seconds)}s` : 'N/A';

        let outcomeBadge = '<span class="badge badge-warning">Unclear</span>';
        if (call.customer_agreed === true) {
            outcomeBadge = '<span class="badge badge-success">Agreed</span>';
        } else if (call.customer_agreed === false) {
            outcomeBadge = '<span class="badge badge-danger">Declined</span>';
        }

        const commitment = call.commitment_date
            ? new Date(call.commitment_date).toLocaleDateString('en-IN')
            : '-';

        row.innerHTML = `
            <td><input type="checkbox" class="call-checkbox" data-id="${call.id}" onchange="toggleSelect(${call.id})" ${selectedCalls.has(call.id) ? 'checked' : ''}></td>
            <td>${dateStr}</td>
            <td>${call.phone_number || 'Unknown'}</td>
            <td>${duration}</td>
            <td>${outcomeBadge}</td>
            <td><span style="font-size: 0.85rem; color: #94a3b8;">${call.disposition || '-'}</span></td>
            <td>${commitment}</td>
            <td class="action-buttons">
                <button class="btn-icon" onclick="openCallDetail(${call.id}, '${call.call_uuid}')" title="View Details">Details</button>
                ${call.has_recording
                ? `<button class="btn-icon" onclick="playRecording(${call.id}, '${call.call_uuid}')" title="Play">Play</button>
                       <button class="btn-icon" onclick="downloadRecording(${call.id}, '${call.call_uuid}')" title="Download">Download</button>`
                : ''}
            </td>
        `;
        tbody.appendChild(row);
    });
}

// ═══════════════════════════════════════════════════════════════
// RECORDING ACTIONS
// ═══════════════════════════════════════════════════════════════

function playRecording(callId, callUuid) {
    const modal = document.getElementById('audio-modal');
    const audioPlayer = document.getElementById('audio-player');
    const infoText = document.getElementById('modal-call-info');

    infoText.textContent = `Call ID: ${callUuid}`;
    audioPlayer.src = `${API_BASE}/calls/${callId}/recording`;

    modal.style.display = 'block';
    audioPlayer.play();
}

function downloadRecording(callId, callUuid) {
    const link = document.createElement('a');
    link.href = `${API_BASE}/calls/${callId}/recording`;
    link.download = `call_${callUuid}.wav`;
    link.click();
    showToast('Downloading recording...', 'info');
}

// ═══════════════════════════════════════════════════════════════
// CALL DETAIL MODAL
// ═══════════════════════════════════════════════════════════════

async function openCallDetail(callId, callUuid) {
    currentDetailCallId = callId;

    try {
        const response = await fetch(`${API_BASE}/calls/${callId}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const call = await response.json();

        document.getElementById('detail-uuid').textContent = call.call_uuid || '-';
        document.getElementById('detail-phone').textContent = call.phone_number || 'Unknown';
        document.getElementById('detail-duration').textContent = call.duration_seconds ? `${Math.round(call.duration_seconds)}s` : 'N/A';
        document.getElementById('detail-status').textContent = call.status || '-';

        let outcomeText = 'Unclear';
        if (call.customer_agreed === true) outcomeText = 'Agreed';
        else if (call.customer_agreed === false) outcomeText = 'Declined';
        document.getElementById('detail-outcome').textContent = outcomeText;

        const datetime = call.start_time ? new Date(call.start_time).toLocaleString('en-IN') : '-';
        document.getElementById('detail-datetime').textContent = datetime;

        // Audio
        if (call.has_recording) {
            document.getElementById('detail-audio-section').style.display = 'block';
            document.getElementById('detail-audio-player').src = `${API_BASE}/calls/${callId}/recording`;
        } else {
            document.getElementById('detail-audio-section').style.display = 'none';
        }

        // Disposition
        const dispSelect = document.getElementById('detail-disposition');
        dispSelect.value = call.disposition || '';

        // Notes
        document.getElementById('detail-notes').value = call.notes || '';

        // Transcript
        const transcriptSection = document.getElementById('detail-transcript-section');
        const transcriptContainer = document.getElementById('detail-transcript');
        if (call.transcript && call.transcript.trim()) {
            transcriptSection.style.display = 'block';
            transcriptContainer.innerHTML = '';

            // Parse transcript lines (format: "User: text" or "Bot: text")
            const lines = call.transcript.split('\n').filter(l => l.trim());
            lines.forEach(line => {
                const match = line.match(/^(User|Bot):\s*(.+)/i);
                if (match) {
                    const role = match[1].toLowerCase();
                    const text = match[2];
                    const bubble = document.createElement('div');
                    bubble.className = `transcript-msg ${role}`;
                    bubble.innerHTML = `<div class="transcript-role">${role === 'user' ? 'Customer' : 'Bot'}</div>${escapeHTML(text)}`;
                    transcriptContainer.appendChild(bubble);
                }
            });

            if (transcriptContainer.children.length === 0) {
                transcriptContainer.innerHTML = '<div class="transcript-empty">No transcript messages</div>';
            }
        } else {
            transcriptSection.style.display = 'none';
        }

        document.getElementById('detail-modal').style.display = 'block';

    } catch (error) {
        console.error('Error loading call details:', error);
        showToast('Failed to load call details', 'error');
    }
}

function closeDetailModal() {
    document.getElementById('detail-modal').style.display = 'none';
    const audioPlayer = document.getElementById('detail-audio-player');
    audioPlayer.pause();
    audioPlayer.src = '';
    document.getElementById('detail-transcript-section').style.display = 'none';
    document.getElementById('detail-transcript').innerHTML = '';
    currentDetailCallId = null;
}

function downloadDetailRecording() {
    if (currentDetailCallId) {
        downloadRecording(currentDetailCallId, 'detail');
    }
}

async function saveNotes() {
    if (!currentDetailCallId) return;
    const notes = document.getElementById('detail-notes').value;

    try {
        await fetch(`${API_BASE}/calls/${currentDetailCallId}/notes`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ notes })
        });
        showToast('Notes saved', 'success');
    } catch (error) {
        showToast('Failed to save notes', 'error');
    }
}

async function saveDisposition() {
    if (!currentDetailCallId) return;
    const disposition = document.getElementById('detail-disposition').value;

    try {
        await fetch(`${API_BASE}/calls/${currentDetailCallId}/disposition`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disposition })
        });
        showToast('Disposition updated', 'success');
        loadCalls(); // Refresh table
    } catch (error) {
        showToast('Failed to update disposition', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// EXPORT & BULK ACTIONS
// ═══════════════════════════════════════════════════════════════

function exportCSV() {
    const params = new URLSearchParams(filters);
    window.open(`${API_BASE}/calls/export/csv?${params}`, '_blank');
    showToast('Exporting CSV...', 'info');
}

function toggleSelect(callId) {
    if (selectedCalls.has(callId)) {
        selectedCalls.delete(callId);
        const row = document.getElementById(`call-row-${callId}`);
        if (row) row.classList.remove('selected-row');
    } else {
        selectedCalls.add(callId);
        const row = document.getElementById(`call-row-${callId}`);
        if (row) row.classList.add('selected-row');
    }
    updateBulkControls();
}

function toggleSelectAll() {
    const selectAll = document.getElementById('select-all');
    const checkboxes = document.querySelectorAll('.call-checkbox');

    checkboxes.forEach(cb => {
        const id = parseInt(cb.dataset.id);
        if (selectAll.checked) {
            selectedCalls.add(id);
            cb.checked = true;
            cb.closest('tr').classList.add('selected-row');
        } else {
            selectedCalls.delete(id);
            cb.checked = false;
            cb.closest('tr').classList.remove('selected-row');
        }
    });
    updateBulkControls();
}

function updateBulkControls() {
    const count = selectedCalls.size;
    document.getElementById('selected-count').textContent = count;
    document.getElementById('bulk-delete-btn').disabled = count === 0;
}

async function deleteSelected() {
    if (selectedCalls.size === 0) return;

    if (!confirm(`Are you sure you want to delete ${selectedCalls.size} call(s)? This cannot be undone.`)) return;

    try {
        const response = await fetch(`${API_BASE}/calls/bulk-delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ call_ids: Array.from(selectedCalls) })
        });
        const data = await response.json();

        showToast(`Deleted ${data.deleted} call(s)`, 'success');
        selectedCalls.clear();
        updateBulkControls();
        document.getElementById('select-all').checked = false;
        loadCalls();
        loadAnalytics();
        loadTodayStats();
    } catch (error) {
        showToast('Failed to delete calls', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════
// FILTERS & PAGINATION
// ═══════════════════════════════════════════════════════════════

function applyFilters() {
    filters = {};
    const startDate = document.getElementById('start-date').value;
    const endDate = document.getElementById('end-date').value;
    const outcome = document.getElementById('outcome-filter').value;
    const phone = document.getElementById('phone-search').value;

    if (startDate) filters.start_date = startDate;
    if (endDate) filters.end_date = endDate;
    if (outcome) filters.outcome = outcome;
    if (phone) filters.phone_number = phone;

    currentPage = 0;
    selectedCalls.clear();
    updateBulkControls();
    loadAnalytics();
    loadCalls();
    loadCharts();
    showToast('Filters applied', 'info');
}

function resetFilters() {
    document.getElementById('start-date').value = '';
    document.getElementById('end-date').value = '';
    document.getElementById('outcome-filter').value = '';
    document.getElementById('phone-search').value = '';

    filters = {};
    currentPage = 0;
    selectedCalls.clear();
    updateBulkControls();
    loadAnalytics();
    loadCalls();
    loadCharts();
    showToast('Filters reset', 'info');
}

function changePage(delta) {
    currentPage = Math.max(0, currentPage + delta);
    selectedCalls.clear();
    updateBulkControls();
    document.getElementById('select-all').checked = false;
    loadCalls();
}

function updatePagination() {
    document.getElementById('page-info').textContent = `Page ${currentPage + 1}`;
    document.getElementById('prev-page').disabled = currentPage === 0;
}

// ═══════════════════════════════════════════════════════════════
// MODALS & UI HELPERS
// ═══════════════════════════════════════════════════════════════

function closeModal() {
    document.getElementById('audio-modal').style.display = 'none';
    document.getElementById('apiModal').style.display = 'none';
    document.getElementById('detail-modal').style.display = 'none';

    const audioPlayer = document.getElementById('audio-player');
    audioPlayer.pause();
    audioPlayer.src = '';

    const detailAudio = document.getElementById('detail-audio-player');
    detailAudio.pause();
    detailAudio.src = '';
}

function showLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.remove('hidden');
}

function hideLoading() {
    const loading = document.getElementById('loading');
    if (loading) loading.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════════════
// TOAST NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════

function showToast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    toast.innerHTML = `<span class="toast-text">${message}</span>`;

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    // Auto-remove
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Escape HTML to prevent XSS
function escapeHTML(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
