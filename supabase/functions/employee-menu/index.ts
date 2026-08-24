// Employee cooking page (spec §10 v1): the share token in the URL is the
// credential. Index = card per assigned meal; ?r=<recipeId> = detail view
// with cover, ingredients and steps. Styled like the app ("Cooking
// editorial" v2). Served through the mealy-menu Cloudflare Worker because
// *.supabase.co refuses to render unauthenticated HTML.
import { createClient } from 'npm:@supabase/supabase-js@2';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const SLOTS: Record<string, string> = { lunch: 'Lunch', dinner: 'Dinner' };

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Monday (UTC) of the current week as YYYY-MM-DD. */
function currentWeekStart(): string {
  const now = new Date();
  const day = (now.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

/** App theme tokens (lib/theme.ts) in CSS, light + dark. */
const CSS = `
:root{--bg:#FFFFFF;--card-pressed:#F5F5F4;--text:#121212;--muted:#72716D;--accent:#C7442E;--border:#E5E3DE}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--card-pressed:#262626;--text:#F5F5F4;--muted:#9C9A94;--accent:#E0604A;--border:#333230}}
*{box-sizing:border-box}
body{font-family:'Libre Franklin',system-ui,sans-serif;background:var(--bg);color:var(--text);max-width:640px;margin:0 auto;padding:24px 20px 64px;line-height:1.5}
h1,h2,h3{font-family:'Bitter',Georgia,serif;letter-spacing:-.3px;margin:0}
h1{font-size:26px;line-height:1.15}
h2{font-size:20px;margin:28px 0 4px}
h3{font-size:17px;font-weight:600;line-height:1.25}
a{color:inherit;text-decoration:none}
.eyebrow{font-size:12px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);margin:0 0 2px}
.muted{color:var(--muted);font-size:13px;margin:2px 0 0}
.back{display:inline-block;font-weight:600;color:var(--accent);font-size:15px;margin-bottom:16px}
.card{display:flex;gap:14px;align-items:center;padding:14px 0;border-bottom:1px solid var(--border)}
.card:active{background:var(--card-pressed)}
.thumb{width:96px;height:72px;border-radius:6px;object-fit:cover;flex:none;background:var(--card-pressed)}
.thumb.empty{display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:22px}
.cover{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:8px;background:var(--card-pressed);margin:16px 0 4px}
.hairline{border:0;border-top:1px solid var(--border);margin:20px 0}
ul.ingredients{list-style:none;margin:8px 0 0;padding:0}
ul.ingredients li{padding:9px 0;border-bottom:1px solid var(--border);font-size:16px}
.step{margin:18px 0}
.step p{margin:2px 0 0;font-size:16px}
`;

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bitter:wght@600;700&family=Libre+Franklin:wght@400;500;600&display=swap" rel="stylesheet">
<style>${CSS}</style></head><body>${body}</body></html>`;
  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  return new Response(html, { status: 200, headers });
}

interface RecipeRow {
  id: string;
  title: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  cover_image_path: string | null;
  ingredients: { raw?: string; name?: string }[];
  steps: string[];
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get('token') ?? '';
  const recipeParam = url.searchParams.get('r');
  const notFound = () =>
    page('Not found', '<h1>Link not valid</h1><p class="muted">Check the link you received.</p>');
  if (!/^[0-9a-f-]{36}$/.test(token)) return notFound();

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: person } = await admin
    .from('persons')
    .select('id, name, household_id, is_employee')
    .eq('share_token', token)
    .maybeSingle();
  if (!person || !person.is_employee) return notFound();

  // Current week only — never past weeks, never future ones.
  const { data: plans } = await admin
    .from('meal_plans')
    .select('id, week_start')
    .eq('household_id', person.household_id)
    .eq('week_start', currentWeekStart())
    .order('week_start');
  const planList = plans ?? [];
  const weekById = new Map(planList.map((p) => [p.id, p.week_start]));

  let entries: {
    meal_plan_id: string;
    day: number;
    slot: string;
    recipe_id: string | null;
    custom_title: string | null;
  }[] = [];
  if (planList.length > 0) {
    const { data: entryRows } = await admin
      .from('plan_entries')
      .select('meal_plan_id, day, slot, recipe_id, custom_title')
      .in('meal_plan_id', planList.map((p) => p.id))
      .eq('assigned_cook', 'employee');
    entries = entryRows ?? [];
  }
  entries.sort((a, b) => {
    const wa = weekById.get(a.meal_plan_id) ?? '';
    const wb = weekById.get(b.meal_plan_id) ?? '';
    return (
      wa.localeCompare(wb) || a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1)
    );
  });

  const recipeIds = [...new Set(entries.map((e) => e.recipe_id).filter((id): id is string => !!id))];
  const recipesById = new Map<string, RecipeRow>();
  if (recipeIds.length > 0) {
    const { data: recipeRows } = await admin
      .from('recipes')
      .select('id, title, servings, prep_minutes, cook_minutes, cover_image_path, ingredients, steps')
      .in('id', recipeIds);
    for (const r of (recipeRows ?? []) as RecipeRow[]) recipesById.set(r.id, r);
  }

  // Signed cover URLs, regenerated per page load (private bucket).
  const coverPaths = [
    ...new Set([...recipesById.values()].map((r) => r.cover_image_path).filter((p): p is string => !!p)),
  ];
  const coverUrl = new Map<string, string>();
  if (coverPaths.length > 0) {
    const { data: signed } = await admin.storage.from('recipe-media').createSignedUrls(coverPaths, 3600);
    for (const s of signed ?? []) {
      if (s.path && s.signedUrl && !s.error) coverUrl.set(s.path, s.signedUrl);
    }
  }

  const slotLine = (entry: { meal_plan_id: string; day: number; slot: string }) =>
    `${DAYS[entry.day] ?? ''} · ${SLOTS[entry.slot] ?? entry.slot} · Week of ${weekById.get(entry.meal_plan_id) ?? ''}`;
  const metaLine = (r: RecipeRow) =>
    [
      r.servings ? `${r.servings} servings` : null,
      r.prep_minutes ? `prep ${r.prep_minutes} min` : null,
      r.cook_minutes ? `cook ${r.cook_minutes} min` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  const thumb = (r: RecipeRow | undefined) => {
    const src = r?.cover_image_path ? coverUrl.get(r.cover_image_path) : undefined;
    return src
      ? `<img class="thumb" src="${esc(src)}" alt="">`
      : '<div class="thumb empty">🍽</div>';
  };

  // ---- Detail view -------------------------------------------------------
  if (recipeParam && recipesById.has(recipeParam)) {
    const recipe = recipesById.get(recipeParam)!;
    const occurrences = entries.filter((e) => e.recipe_id === recipe.id);
    const cover = recipe.cover_image_path ? coverUrl.get(recipe.cover_image_path) : undefined;

    let body = `<a class="back" href="?token=${esc(token)}">‹ All meals</a>`;
    if (cover) body += `<img class="cover" src="${esc(cover)}" alt="">`;
    body += `<h1>${esc(recipe.title)}</h1>`;
    const meta = metaLine(recipe);
    if (meta) body += `<p class="muted">${esc(meta)}</p>`;
    for (const occ of occurrences) {
      body += `<p class="eyebrow" style="margin-top:8px">${esc(slotLine(occ))}</p>`;
    }
    const ingredients = (recipe.ingredients ?? []).map((i) => i.raw || i.name || '').filter(Boolean);
    if (ingredients.length > 0) {
      body += `<h2>Ingredients</h2><ul class="ingredients">${ingredients
        .map((i) => `<li>${esc(i)}</li>`)
        .join('')}</ul>`;
    }
    if ((recipe.steps ?? []).length > 0) {
      body += '<h2>Steps</h2>';
      body += recipe.steps
        .map(
          (s, i) => `<div class="step"><p class="eyebrow">Step ${i + 1}</p><p>${esc(s)}</p></div>`
        )
        .join('');
    }
    return page(recipe.title, body);
  }

  // ---- Index: one card per assigned meal --------------------------------
  let body = `<h1>Meals to cook</h1><p class="muted">For ${esc(person.name)}</p>`;
  if (entries.length === 0) {
    body += '<hr class="hairline"><p>No meals assigned right now — check back later.</p>';
  }

  let lastWeek = '';
  for (const entry of entries) {
    const week = weekById.get(entry.meal_plan_id) ?? '';
    if (week !== lastWeek) {
      body += `<h2>Week of ${esc(week)}</h2>`;
      lastWeek = week;
    }
    const recipe = entry.recipe_id ? recipesById.get(entry.recipe_id) : undefined;
    const inner = `${thumb(recipe)}<div><p class="eyebrow">${esc(
      `${DAYS[entry.day] ?? ''} · ${SLOTS[entry.slot] ?? entry.slot}`
    )}</p><h3>${esc(recipe?.title ?? entry.custom_title ?? 'Meal')}</h3>${
      recipe && metaLine(recipe) ? `<p class="muted">${esc(metaLine(recipe))}</p>` : ''
    }</div>`;
    body += recipe
      ? `<a class="card" href="?token=${esc(token)}&r=${esc(recipe.id)}">${inner}</a>`
      : `<div class="card">${inner}</div>`;
  }

  return page(`Meals to cook — ${person.name}`, body);
});
