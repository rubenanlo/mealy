/**
 * Public site for mealy.family — homepage, privacy policy, and terms of
 * service. These pages exist chiefly so the Google OAuth consent screen can
 * point at a real homepage/privacy/terms on an authorized domain (required
 * to publish the OAuth app to production), and so Resend has a domain to
 * send from. Mealy itself is a private, invite-only household app; there is
 * no public signup here.
 */

const STYLE = `
  :root { color-scheme: light; }
  body { margin: 0; background: #F4F2ED; color: #1C1C1C;
    font: 17px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 48px 24px 72px; }
  h1 { font-family: Georgia, "Times New Roman", serif; font-size: 34px; margin: 0 0 6px; }
  h2 { font-family: Georgia, "Times New Roman", serif; font-size: 22px; margin: 32px 0 8px; }
  p, li { color: #3A3A3A; }
  .tagline { color: #8A857C; letter-spacing: .08em; text-transform: uppercase;
    font-size: 13px; font-weight: 600; margin: 0 0 24px; }
  .muted { color: #777; font-size: 15px; }
  a { color: #B4552D; }
  nav { margin-top: 40px; padding-top: 16px; border-top: 1px solid #E0DCD3; font-size: 15px; }
  nav a { margin-right: 16px; }
`;

function page(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
${body}
<nav>
  <a href="/">Home</a>
  <a href="/privacy">Privacy policy</a>
  <a href="/terms">Terms of service</a>
</nav>
</main>
</body>
</html>`;
}

const HOME = page(
  'Mealy — the family cooking notebook',
  `
<h1>Mealy</h1>
<p class="tagline">The family cooking notebook</p>
<p>Mealy is a private meal planner for our household and a small circle of
family and friends. It captures recipes from anywhere — links, photos,
videos — keeps the original text alongside a tidy structured version, plans
the week's lunches and dinners for each person, and turns the plan into a
grams-first shopping list.</p>
<p>Mealy is invite-only. There is no public signup: accounts are created by
the family that runs it.</p>
<p class="muted">Questions? Write to
<a href="mailto:ruben.raw.dev@gmail.com">ruben.raw.dev@gmail.com</a>.</p>
`
);

const PRIVACY = page(
  'Privacy policy — Mealy',
  `
<h1>Privacy policy</h1>
<p class="muted">Effective 27 August 2026</p>
<p>Mealy is a private, invite-only app used by one household and its guests.
This page explains what the app stores and how it is used.</p>

<h2>What we store</h2>
<ul>
  <li>Your account: email address, name, and household membership.</li>
  <li>What you put in the app: recipes (including text and images you import
  or photograph), meal plans, grocery lists, and per-person food
  preferences.</li>
</ul>

<h2>Sign-in</h2>
<p>You can sign in with an email code or password, or through Google or
Apple. When you use Google or Apple sign-in we receive only your name and
email address from them — nothing else from your Google or Apple account is
accessed.</p>

<h2>Where data lives</h2>
<p>Data is stored with Supabase on servers in the European Union
(Paris region). Recipe imports are processed by our own ingestion service,
which may send recipe text to AI providers (Anthropic, OpenAI) solely to
structure and translate it.</p>

<h2>What we don't do</h2>
<ul>
  <li>No advertising and no third-party analytics or tracking.</li>
  <li>Your data is never sold or shared beyond the services named above.</li>
</ul>

<h2>Deletion</h2>
<p>To have your account and data removed, email
<a href="mailto:ruben.raw.dev@gmail.com">ruben.raw.dev@gmail.com</a> and it
will be deleted.</p>
`
);

const TERMS = page(
  'Terms of service — Mealy',
  `
<h1>Terms of service</h1>
<p class="muted">Effective 27 August 2026</p>
<p>Mealy is a personal, non-commercial app operated for one household and
its invited family and friends.</p>
<ul>
  <li>Use of Mealy is by invitation and for personal, household purposes
  only.</li>
  <li>Content you add (recipes, photos, plans) remains yours. Recipes you
  import from elsewhere remain the property of their original authors; keep
  your use of them personal.</li>
  <li>The service is provided as-is, without warranties of any kind, and may
  change or be discontinued at any time.</li>
  <li>To the maximum extent permitted by law, the operator is not liable for
  any damages arising from use of the service.</li>
  <li>Accounts that misuse the service may be removed.</li>
</ul>
<p class="muted">Questions about these terms:
<a href="mailto:ruben.raw.dev@gmail.com">ruben.raw.dev@gmail.com</a>.</p>
`
);

const NOT_FOUND = page(
  'Not found — Mealy',
  `
<h1>Page not found</h1>
<p>There is nothing at this address.</p>
`
);

const ROUTES = {
  '/': HOME,
  '/privacy': PRIVACY,
  '/terms': TERMS,
};

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const html = ROUTES[pathname.replace(/\/+$/, '') || '/'];
    return new Response(html ?? NOT_FOUND, {
      status: html ? 200 : 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  },
};
