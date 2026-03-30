/**
 * WCRS Popup Script
 * Manages the extension popup UI state and communicates with background.js.
 */

(function () {
  'use strict';

  let recordingStartTime = null;
  let durationTimer = null;

  // ── DOM References ───────────────────────────────────────────────────────
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const toast = document.getElementById('toast');
  const idleSection = document.getElementById('idle-section');
  const recordingSection = document.getElementById('recording-section');
  const exportSection = document.getElementById('export-section');
  const actionCountEl = document.getElementById('action-count');
  const finalCountEl = document.getElementById('final-count');
  const durationEl = document.getElementById('recording-duration');
  const targetAppInput = document.getElementById('target-app');
  const checkpointSection = document.getElementById('checkpoint-section');
  const checkpointLabelInput = document.getElementById('checkpoint-label');

  // ── Initialization ───────────────────────────────────────────────────────
  init();

  async function init() {
    const response = await sendMessage({ type: 'GET_STATUS' });
    if (response?.recording) {
      showRecordingState(response.session?.actionCount || 0);
    }
  }

  // ── Button Handlers ──────────────────────────────────────────────────────
  document.getElementById('btn-start').addEventListener('click', async () => {
    const targetApp = targetAppInput.value.trim() || 'unknown';
    setButtonsDisabled(true);
    showToast('Starting recording...');

    const response = await sendMessage({ type: 'START_RECORDING', config: { targetApp } });
    if (response?.success) {
      showRecordingState(0);
      showToast('Recording started!', 2000);
    } else {
      showToast('Error: ' + (response?.error || 'Unknown error'));
      setButtonsDisabled(false);
    }
  });

  document.getElementById('btn-stop').addEventListener('click', async () => {
    setButtonsDisabled(true);
    showToast('Stopping recording...');

    const response = await sendMessage({ type: 'STOP_RECORDING' });
    if (response?.success) {
      showExportState(response.trace?.actions?.length || 0);
      showToast('Recording saved!', 2000);
    } else {
      showToast('Error: ' + (response?.error || 'Unknown error'));
      setButtonsDisabled(false);
    }
  });

  document.getElementById('btn-checkpoint').addEventListener('click', () => {
    checkpointSection.classList.toggle('visible');
    if (checkpointSection.classList.contains('visible')) {
      checkpointLabelInput.focus();
    }
  });

  document.getElementById('btn-add-checkpoint').addEventListener('click', async () => {
    const label = checkpointLabelInput.value.trim();
    if (!label) return;
    await sendMessage({ type: 'ADD_CHECKPOINT', label });
    checkpointLabelInput.value = '';
    checkpointSection.classList.remove('visible');
    showToast('Checkpoint added: ' + label, 1500);
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    showToast('Exporting trace...');
    const response = await sendMessage({ type: 'EXPORT_TRACE' });
    if (response?.success) {
      showToast('Trace exported!', 2000);
    } else {
      showToast('Export error: ' + (response?.error || 'Unknown'));
    }
  });

  document.getElementById('btn-new').addEventListener('click', () => {
    showIdleState();
  });

  // ── UI State Management ──────────────────────────────────────────────────

  function showIdleState() {
    idleSection.style.display = 'block';
    recordingSection.style.display = 'none';
    exportSection.style.display = 'none';
    statusBadge.className = 'status-badge idle';
    statusText.textContent = 'Ready to Record';
    stopDurationTimer();
    setButtonsDisabled(false);
  }

  function showRecordingState(count) {
    idleSection.style.display = 'none';
    recordingSection.style.display = 'block';
    exportSection.style.display = 'none';
    statusBadge.className = 'status-badge recording';
    statusText.textContent = 'Recording...';
    actionCountEl.textContent = count;
    recordingStartTime = Date.now();
    startDurationTimer();
    startActionCountPoller();
    setButtonsDisabled(false);
  }

  function showExportState(count) {
    idleSection.style.display = 'none';
    recordingSection.style.display = 'none';
    exportSection.style.display = 'block';
    statusBadge.className = 'status-badge idle';
    statusText.textContent = 'Recording Complete';
    finalCountEl.textContent = count;
    stopDurationTimer();
    setButtonsDisabled(false);
  }

  // ── Duration Timer ───────────────────────────────────────────────────────

  function startDurationTimer() {
    durationTimer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - recordingStartTime) / 1000);
      const mins = String(Math.floor(elapsed / 60)).padStart(2, '0');
      const secs = String(elapsed % 60).padStart(2, '0');
      durationEl.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  function stopDurationTimer() {
    if (durationTimer) { clearInterval(durationTimer); durationTimer = null; }
  }

  // ── Action Count Poller ──────────────────────────────────────────────────

  let actionPoller = null;

  function startActionCountPoller() {
    actionPoller = setInterval(async () => {
      const response = await sendMessage({ type: 'GET_STATUS' });
      if (response?.recording && response?.session) {
        actionCountEl.textContent = response.session.actionCount;
      } else {
        clearInterval(actionPoller);
      }
    }, 1000);
  }

  // ── Toast ────────────────────────────────────────────────────────────────

  let toastTimeout = null;

  function showToast(message, duration = 0) {
    toast.textContent = message;
    toast.classList.add('visible');
    if (toastTimeout) clearTimeout(toastTimeout);
    if (duration > 0) {
      toastTimeout = setTimeout(() => toast.classList.remove('visible'), duration);
    }
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  function setButtonsDisabled(disabled) {
    document.querySelectorAll('.btn').forEach(btn => (btn.disabled = disabled));
  }

  function sendMessage(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response);
        }
      });
    });
  }
})();
