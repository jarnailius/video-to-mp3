require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const mime = require('mime-types');
const rimraf = require('rimraf');
const helmet = require('helmet');
const cors = require('cors');

ffmpeg.setFfmpegPath(ffmpegPath);

const PORT = process.env.PORT || 3000;
const MAX_FILE_BYTES = parseInt(process.env.MAX_FILE_BYTES) || 200 * 1024 * 1024; // 200MB
const TTL_MS = parseInt(process.env.TTL_SEC || '3600') * 1000; // default 1 hour

const UPLOAD_DIR = path.join(__dirname, '..', 'tmp', 'uploads');
const OUT_DIR = path.join(__dirname, '..', 'tmp', 'outputs');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.static(path.join(__dirname, '..', 'public')));

// In-memory job store (for MVP). In production use persistent store or queue system.
const jobs = new Map();

const allowedMime = new Set([
  'video/mp4',
  'video/quicktime', // mov
  'video/webm',
  'video/x-matroska' // mkv
]);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename: function (req, file, cb) {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter: function (req, file, cb) {
    if (!allowedMime.has(file.mimetype)) {
      return cb(new Error('Invalid file type'));
    }
    cb(null, true);
  }
});

function scheduleCleanup(jobId, delayMs = TTL_MS) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.expiresAt = Date.now() + delayMs;
  job.cleanupTimer = setTimeout(() => {
    try {
      if (job.inputPath && fs.existsSync(job.inputPath)) fs.unlinkSync(job.inputPath);
      if (job.outputPath && fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
    } catch (e) {
      console.error('cleanup error', e);
    }
    jobs.delete(jobId);
  }, delayMs);
}

function safeSendJSON(res, code, obj) {
  res.status(code).json(obj);
}

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return safeSendJSON(res, 400, { error: 'No file uploaded' });

  // Create job
  const jobId = uuidv4();
  const inputPath = req.file.path;
  const outputPath = path.join(OUT_DIR, `${jobId}.mp3`);

  const job = {
    id: jobId,
    status: 'queued',
    progress: 0,
    inputPath,
    outputPath,
    createdAt: Date.now()
  };
  jobs.set(jobId, job);

  // Start processing asynchronously
  process.nextTick(() => convertToMp3(jobId));

  const statusUrl = `/api/status/${jobId}`;
  return safeSendJSON(res, 202, { jobId, statusUrl, downloadUrl: `/api/download/${jobId}` });
});

async function convertToMp3(jobId) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'processing';

  try {
    ffmpeg(job.inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('progress', p => {
        // p.percent may be undefined for some inputs
        job.progress = Math.round(p.percent || 0);
      })
      .on('end', () => {
        job.status = 'done';
        job.progress = 100;
        job.finishedAt = Date.now();
        scheduleCleanup(jobId);
        console.log(`Job ${jobId} completed`);
      })
      .on('error', (err, stdout, stderr) => {
        job.status = 'error';
        job.error = err.message || String(err);
        job.finishedAt = Date.now();
        scheduleCleanup(jobId);
        console.error('ffmpeg error', err);
      })
      .save(job.outputPath);
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
    scheduleCleanup(jobId);
  }
}

app.get('/api/status/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return safeSendJSON(res, 404, { error: 'Job not found' });
  const response = {
    id: job.id,
    status: job.status,
    progress: job.progress || 0,
    downloadUrl: job.status === 'done' ? `/api/download/${job.id}` : undefined,
    error: job.error
  };
  safeSendJSON(res, 200, response);
});

app.get('/api/download/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return safeSendJSON(res, 404, { error: 'Job not found' });
  if (job.status !== 'done' || !fs.existsSync(job.outputPath)) return safeSendJSON(res, 400, { error: 'Output not ready' });
  res.download(job.outputPath, `audio-${job.id}.mp3`);
});

// Health
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Periodic sweep for expired jobs (in case of server restart or missed timers)
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (job.expiresAt && job.expiresAt <= now) {
      try {
        if (job.inputPath && fs.existsSync(job.inputPath)) fs.unlinkSync(job.inputPath);
        if (job.outputPath && fs.existsSync(job.outputPath)) fs.unlinkSync(job.outputPath);
      } catch (e) {
        console.error('sweep cleanup error', e);
      }
      jobs.delete(id);
    }
  }
}, 10 * 60 * 1000);

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
