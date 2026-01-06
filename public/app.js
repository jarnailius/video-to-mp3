const form = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const statusList = document.getElementById('statusList');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return alert('Choose a file');
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json();
    return alert('Upload failed: ' + (err.error || res.statusText));
  }
  const body = await res.json();
  const id = body.jobId;

  const el = document.createElement('div');
  el.className = 'card';
  el.innerHTML = `<strong>Job:</strong> ${id}<div class="progress" style="margin-top:8px"><div class="bar" id="bar-${id}"></div></div><div id="info-${id}" style="margin-top:8px">Queued...</div>`;
  statusList.prepend(el);

  const info = document.getElementById(`info-${id}`);
  const bar = document.getElementById(`bar-${id}`);

  // poll status
  const interval = setInterval(async () => {
    const s = await (await fetch(`/api/status/${id}`)).json();
    bar.style.width = (s.progress || 0) + '%';
    info.textContent = s.status + (s.error ? ' - ' + s.error : '');
    if (s.status === 'done') {
      clearInterval(interval);
      info.innerHTML = `Completed — <a href="${s.downloadUrl}">Download MP3</a>`;
    }
    if (s.status === 'error') {
      clearInterval(interval);
    }
  }, 1500);
});