#!/bin/sh
# Secrets can only be env vars on Fly; yt-dlp wants its cookies as a FILE.
# If YTDLP_COOKIES_CONTENT is set, write it to disk and point yt-dlp at it.
set -e

if [ -n "$YTDLP_COOKIES_CONTENT" ]; then
  printf '%s' "$YTDLP_COOKIES_CONTENT" > /tmp/ytdlp-cookies.txt
  export YTDLP_COOKIES_FILE=/tmp/ytdlp-cookies.txt
fi

exec uvicorn mealy_worker.main:app --host 0.0.0.0 --port 8080
