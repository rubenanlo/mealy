/**
 * Thin proxy for the employee cooking page (spec §10 v1).
 *
 * Supabase refuses to serve HTML to unauthenticated browsers on
 * *.supabase.co (anti-phishing: it rewrites Content-Type to text/plain +
 * nosniff), so this Worker fetches the employee-menu edge function and
 * re-serves the body as real HTML from workers.dev.
 */
const ORIGIN = 'https://fcqtywqwhddlyirhwbzq.supabase.co/functions/v1/employee-menu';

export default {
  async fetch(request) {
    // Forward the full query string (token + detail-view params).
    const upstream = await fetch(`${ORIGIN}${new URL(request.url).search}`);
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  },
};
