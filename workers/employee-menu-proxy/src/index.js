/**
 * Thin proxy for the employee cooking page (spec §10 v1) — plus /invite,
 * the landing page for family-member invitation emails.
 *
 * Supabase refuses to serve HTML to unauthenticated browsers on
 * *.supabase.co (anti-phishing: it rewrites Content-Type to text/plain +
 * nosniff), so this Worker fetches the employee-menu edge function and
 * re-serves the body as real HTML from workers.dev.
 *
 * /invite: Supabase's invite email verifies the token and redirects here
 * with a session in the URL fragment (#access_token=…). The page lets the
 * invitee set a password (PUT /auth/v1/user), then tells them to sign in
 * from the app. The anon key below is the public client key by design.
 */
const SUPABASE_URL = 'https://fcqtywqwhddlyirhwbzq.supabase.co';
const ORIGIN = `${SUPABASE_URL}/functions/v1/employee-menu`;
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjcXR5d3F3aGRkbHlpcmh3YnpxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyMTYxODgsImV4cCI6MjEwMjc5MjE4OH0.ApGJ4mltClHGr4rxMDE8UGdGsGA__1Pz0m_DYvhx-oU';

const INVITE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Join Mealy</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; background: #F4F2ED; color: #1C1C1C;
    font: 17px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
    display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  main { width: min(420px, calc(100vw - 48px)); }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 30px; margin: 0 0 6px; }
  p { margin: 8px 0 18px; color: #555; }
  input { width: 100%; box-sizing: border-box; font-size: 17px; padding: 13px 14px;
    border: 2px solid transparent; border-radius: 12px; background: #E9E6DF; margin-bottom: 12px; }
  input:focus { outline: none; border-color: #1C1C1C; background: #fff; }
  button { width: 100%; font-size: 17px; font-weight: 600; padding: 14px;
    border: 0; border-radius: 12px; background: #B4552D; color: #fff; cursor: pointer; }
  button:disabled { opacity: .5; }
  .error { color: #C7442E; margin-top: 12px; }
  .ok { color: #2E6B34; margin-top: 12px; }
  #done, #invalid { display: none; }
</style>
</head>
<body>
<main>
  <h1>Welcome to Mealy</h1>
  <div id="form">
    <p>Choose a password for your account. You will use it to sign in from the Mealy app.</p>
    <input id="pw" type="password" placeholder="Password (min. 8 characters)" autocomplete="new-password">
    <input id="pw2" type="password" placeholder="Repeat the password" autocomplete="new-password">
    <button id="go">Save password</button>
    <div id="msg" class="error"></div>
  </div>
  <div id="done">
    <p class="ok">Your password is saved. Open the Mealy app on your phone and sign in with your email address.</p>
  </div>
  <div id="invalid">
    <p class="error">This invitation link is invalid or has expired. Ask for a new invite from the family account.</p>
  </div>
</main>
<script>
  var params = new URLSearchParams(location.hash.slice(1));
  var token = params.get('access_token');
  var error = params.get('error_description');
  if (!token || error) {
    document.getElementById('form').style.display = 'none';
    document.getElementById('invalid').style.display = 'block';
  }
  document.getElementById('go').addEventListener('click', function () {
    var pw = document.getElementById('pw').value;
    var pw2 = document.getElementById('pw2').value;
    var msg = document.getElementById('msg');
    msg.textContent = '';
    if (pw.length < 8) { msg.textContent = 'Use at least 8 characters.'; return; }
    if (pw !== pw2) { msg.textContent = 'The passwords do not match.'; return; }
    var button = document.getElementById('go');
    button.disabled = true;
    fetch('${SUPABASE_URL}/auth/v1/user', {
      method: 'PUT',
      headers: {
        apikey: '${ANON_KEY}',
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password: pw }),
    })
      .then(function (r) { return r.ok ? null : r.json().then(function (b) { throw new Error(b.msg || b.message || r.status); }); })
      .then(function () {
        document.getElementById('form').style.display = 'none';
        document.getElementById('done').style.display = 'block';
      })
      .catch(function (e) {
        button.disabled = false;
        msg.textContent = 'Could not save the password: ' + e.message;
      });
  });
</script>
</body>
</html>`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/invite') {
      return new Response(INVITE_PAGE, {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Robots-Tag': 'noindex',
        },
      });
    }
    // Forward the full query string (token + detail-view params).
    const upstream = await fetch(`${ORIGIN}${url.search}`);
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
