// FlixParty - Options & Permissions Page Logic
// Manifest V3 best practice: async/await throughout

document.addEventListener('DOMContentLoaded', async () => {
  const usernameInput = document.getElementById('usernameInput');
  const serverUrlInput = document.getElementById('serverUrlInput');
  const controlModeSelect = document.getElementById('controlModeSelect');
  const saveBtn = document.getElementById('saveBtn');
  const saveNotice = document.getElementById('saveNotice');

  const testMediaBtn = document.getElementById('testMediaBtn');
  const stopMediaBtn = document.getElementById('stopMediaBtn');
  const previewVideo = document.getElementById('previewVideo');
  const videoPlaceholder = document.getElementById('videoPlaceholder');
  const meterFill = document.getElementById('meterFill');
  const dbLevel = document.getElementById('dbLevel');

  let testStream = null;
  let audioContext = null;
  let analyser = null;
  let animFrameId = null;

  // Load existing settings
  const settings = await chrome.storage.local.get(['username', 'serverUrl', 'controlMode']);
  usernameInput.value = settings.username || '';
  serverUrlInput.value = settings.serverUrl || 'ws://localhost:3000';
  if (settings.controlMode) {
    controlModeSelect.value = settings.controlMode;
  }

  // Save Settings
  saveBtn.addEventListener('click', async () => {
    const username = usernameInput.value.trim() || 'Friend';
    const serverUrl = serverUrlInput.value.trim() || 'ws://localhost:3000';
    const controlMode = controlModeSelect.value;

    await chrome.storage.local.set({ username, serverUrl, controlMode });

    saveNotice.classList.add('show');
    setTimeout(() => {
      saveNotice.classList.remove('show');
    }, 2500);
  });

  // Start Media Test
  testMediaBtn.addEventListener('click', async () => {
    try {
      testStream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true
      });

      previewVideo.srcObject = testStream;
      videoPlaceholder.style.display = 'none';
      testMediaBtn.style.display = 'none';
      stopMediaBtn.style.display = 'inline-block';

      // Setup Audio Visualizer Meter
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      audioContext = new AudioCtx();
      const source = audioContext.createMediaStreamSource(testStream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const buffer = new Uint8Array(analyser.frequencyBinCount);

      const updateMeter = () => {
        analyser.getByteFrequencyData(buffer);
        const sum = buffer.reduce((a, b) => a + b, 0);
        const avg = sum / buffer.length;
        const percentage = Math.min(100, Math.round((avg / 128) * 100));

        meterFill.style.width = `${percentage}%`;
        dbLevel.textContent = `${percentage}%`;

        animFrameId = requestAnimationFrame(updateMeter);
      };

      updateMeter();
    } catch (err) {
      alert(`Could not access camera/microphone: ${err.message}. Please check browser permissions.`);
    }
  });

  // Stop Media Test
  stopMediaBtn.addEventListener('click', () => {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    if (audioContext) audioContext.close();

    if (testStream) {
      testStream.getTracks().forEach(track => track.stop());
      testStream = null;
    }

    previewVideo.srcObject = null;
    videoPlaceholder.style.display = 'flex';
    meterFill.style.width = '0%';
    dbLevel.textContent = '0%';

    testMediaBtn.style.display = 'inline-block';
    stopMediaBtn.style.display = 'none';
  });
});

