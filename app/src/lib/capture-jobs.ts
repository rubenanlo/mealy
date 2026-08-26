import { supabase } from '@/lib/supabase';
import { detectCaptureKind, extractCaptureUrl, type MediaAsset } from '@/lib/worker';
import { workerUrl } from '@/lib/worker-url';

/**
 * True background capture (pasted URL / social link / recipe text).
 * The app inserts a capture_jobs row and pings the worker's /jobs/run; the
 * worker runs the pipeline and writes the recipe rows itself, so the import
 * survives the app closing. The library shows pending/failed jobs and polls
 * while any are active. Photos/PDF ride the same rails: the files are
 * uploaded to Storage first, and the job row points at them.
 */

export type CaptureJobKind = 'url' | 'social' | 'text' | 'images' | 'pdf';
export type CaptureJobStatus = 'pending' | 'processing' | 'done' | 'failed';

/** Worker error code for "pipeline ran but found no recipe". */
export const JOB_ERROR_NO_RECIPE = 'no_recipe';

export interface CaptureJobRow {
  id: string;
  kind: CaptureJobKind;
  input: string;
  status: CaptureJobStatus;
  error: string | null;
  recipe_id: string | null;
  created_at: string;
}

/** Normalize pasted input into the job payload: URLs lose share-sheet cruft. */
export function jobPayload(input: string): { kind: CaptureJobKind; input: string } {
  const kind = detectCaptureKind(input);
  return { kind, input: kind === 'text' ? input : (extractCaptureUrl(input) ?? input.trim()) };
}

/**
 * Queue a background capture: insert the job row, then fire-and-forget the
 * worker ping. If the ping fails the job stays pending and a retry re-pings.
 */
export async function createCaptureJob(
  input: string,
  ctx: { householdId: string; userId: string }
): Promise<string> {
  const payload = jobPayload(input);
  const { data, error } = await supabase
    .from('capture_jobs')
    .insert({
      household_id: ctx.householdId,
      created_by: ctx.userId,
      kind: payload.kind,
      input: payload.input,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`Could not queue the import: ${error?.message}`);
  }
  const jobId = data.id as string;
  void triggerCaptureJob(jobId);
  return jobId;
}

/** Storage folder id for a media job's files (uniqueness, not a secret). */
function mediaFolderId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

async function uploadJobAsset(path: string, asset: MediaAsset): Promise<void> {
  const data = await fetch(asset.uri).then((r) => r.arrayBuffer());
  const { error } = await supabase.storage.from('recipe-media').upload(path, data, {
    contentType: asset.mimeType ?? 'application/octet-stream',
    upsert: true,
  });
  if (error) throw new Error(`Media upload failed: ${error.message}`);
}

/**
 * Queue a background photos/PDF capture: upload the files to Storage first
 * (so the import survives the app closing), then insert the job row pointing
 * at them and ping the worker. `label` is what the library card displays.
 */
export async function createMediaCaptureJob(
  kind: 'images' | 'pdf',
  assets: MediaAsset[],
  label: string,
  ctx: { householdId: string; userId: string }
): Promise<string> {
  const folder = mediaFolderId();
  const media: { path: string; mime: string }[] = [];
  for (let i = 0; i < assets.length; i++) {
    const path = `${ctx.householdId}/jobs/${folder}/${i}`;
    await uploadJobAsset(path, assets[i]);
    media.push({ path, mime: assets[i].mimeType ?? 'application/octet-stream' });
  }
  const { data, error } = await supabase
    .from('capture_jobs')
    .insert({
      household_id: ctx.householdId,
      created_by: ctx.userId,
      kind,
      input: label,
      media,
    })
    .select('id')
    .single();
  if (error || !data) {
    throw new Error(`Could not queue the import: ${error?.message}`);
  }
  const jobId = data.id as string;
  void triggerCaptureJob(jobId);
  return jobId;
}

/** Ask the worker to process a job. Safe to call repeatedly. */
export async function triggerCaptureJob(jobId: string): Promise<boolean> {
  const base = workerUrl();
  if (!base) return false;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const response = await fetch(`${base}/jobs/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Failed → pending again, then re-ping the worker. */
export async function retryCaptureJob(jobId: string): Promise<void> {
  await supabase.from('capture_jobs').update({ status: 'pending', error: null }).eq('id', jobId);
  void triggerCaptureJob(jobId);
}

export async function dismissCaptureJob(jobId: string): Promise<void> {
  await supabase.from('capture_jobs').delete().eq('id', jobId);
}

/**
 * Re-ping pending jobs that look stuck — the app may have died before the
 * original ping reached the worker, or the worker may have been down. The
 * worker claims jobs atomically, so duplicate pings are harmless.
 */
export function retriggerStaleJobs(jobs: CaptureJobRow[], nowMs: number = Date.now()): void {
  for (const job of jobs) {
    if (job.status !== 'pending') continue;
    if (nowMs - new Date(job.created_at).getTime() < 30_000) continue;
    void triggerCaptureJob(job.id);
  }
}

/** Jobs the library should surface: anything not finished. */
export async function loadActiveCaptureJobs(householdId: string): Promise<CaptureJobRow[]> {
  const { data } = await supabase
    .from('capture_jobs')
    .select('id, kind, input, status, error, recipe_id, created_at')
    .eq('household_id', householdId)
    .in('status', ['pending', 'processing', 'failed'])
    .order('created_at', { ascending: false });
  return (data as CaptureJobRow[]) ?? [];
}
