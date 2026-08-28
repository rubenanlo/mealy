-- Photos/PDF join background capture: the app uploads the files to the
-- recipe-media bucket first (under {household}/jobs/{folder}/{i}), then the
-- job row points at them so the worker (service role) can download and
-- process after the app is gone. `input` holds a display label for these
-- kinds instead of a URL/text payload.

alter table capture_jobs drop constraint capture_jobs_kind_check;
alter table capture_jobs add constraint capture_jobs_kind_check
  check (kind in ('url', 'social', 'text', 'images', 'pdf'));

-- [{"path": "hh/jobs/abc/0", "mime": "image/jpeg"}, ...]
alter table capture_jobs add column media jsonb;
