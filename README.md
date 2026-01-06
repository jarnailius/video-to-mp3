# Video → MP3 (MVP)

Simple web app to extract MP3 audio from user-owned video files.

Features (MVP):
- Upload local video files (mp4/mov/webm/mkv)
- Server converts audio to MP3 using ffmpeg
- Download the MP3
- Files are kept ephemeral and deleted after a TTL (default 1 hour)

Security & Compliance:
- App accepts user uploads only (no scraping or third-party pages)
- File type and size checks
- Use ffmpeg (ffmpeg-static) for robust conversions

Quick start (local):

1. Install dependencies

   npm ci

2. Start server

   npm start

3. Open http://localhost:3000

Notes:
- Configure `MAX_FILE_BYTES` and `TTL_SEC` via environment variables if needed.
- This is an MVP: use a queue/persistent store and virus-scanning in production.
