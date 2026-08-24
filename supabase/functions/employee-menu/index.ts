// Public web page for household employees (spec §10 v1): the share token in
// the URL is the credential. Shows every meal assigned to the employee cook
// from the current week onward, with ingredients and steps. Read-only.
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

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style>
  body{font-family:Georgia,serif;max-width:640px;margin:0 auto;padding:24px 16px;color:#121212;background:#fff}
  h1{font-size:26px;margin:0 0 4px}
  .muted{color:#72716D;font-size:14px}
  h2{font-size:20px;border-bottom:1px solid #E5E3DE;padding-bottom:6px;margin:28px 0 8px}
  h3{font-size:16px;margin:18px 0 4px}
  .slot{color:#72716D;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:14px 0 2px}
  ul{margin:6px 0;padding-left:20px}
  ol{margin:6px 0;padding-left:20px}
  li{margin:3px 0;line-height:1.45}
  .meta{color:#72716D;font-size:13px;margin:0 0 6px}
</style></head><body>${body}</body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

Deno.serve(async (req) => {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!/^[0-9a-f-]{36}$/.test(token)) {
    return page('Not found', '<h1>Link not valid</h1><p class="muted">Check the link you received.</p>');
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: person } = await admin
    .from('persons')
    .select('id, name, household_id, is_employee')
    .eq('share_token', token)
    .maybeSingle();
  if (!person || !person.is_employee) {
    return page('Not found', '<h1>Link not valid</h1><p class="muted">Check the link you received.</p>');
  }

  const weekStart = currentWeekStart();
  const { data: plans } = await admin
    .from('meal_plans')
    .select('id, week_start')
    .eq('household_id', person.household_id)
    .gte('week_start', weekStart)
    .order('week_start');

  const planList = plans ?? [];
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

  const recipeIds = [...new Set(entries.map((e) => e.recipe_id).filter((id): id is string => !!id))];
  const recipesById = new Map<string, {
    title: string;
    servings: number | null;
    prep_minutes: number | null;
    cook_minutes: number | null;
    ingredients: { raw?: string; name?: string }[];
    steps: string[];
  }>();
  if (recipeIds.length > 0) {
    const { data: recipeRows } = await admin
      .from('recipes')
      .select('id, title, servings, prep_minutes, cook_minutes, ingredients, steps')
      .in('id', recipeIds);
    for (const r of recipeRows ?? []) recipesById.set(r.id, r);
  }

  let body = `<h1>Meals to cook</h1><p class="muted">For ${esc(person.name)} · updated ${new Date()
    .toISOString()
    .slice(0, 10)}</p>`;

  if (entries.length === 0) {
    body += '<p>No meals assigned right now — check back later.</p>';
  }

  for (const plan of planList) {
    const planEntries = entries
      .filter((e) => e.meal_plan_id === plan.id)
      .sort((a, b) => a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1));
    if (planEntries.length === 0) continue;
    body += `<h2>Week of ${esc(plan.week_start)}</h2>`;
    for (const entry of planEntries) {
      body += `<p class="slot">${esc(DAYS[entry.day] ?? '')} · ${esc(SLOTS[entry.slot] ?? entry.slot)}</p>`;
      const recipe = entry.recipe_id ? recipesById.get(entry.recipe_id) : undefined;
      if (!recipe) {
        body += `<h3>${esc(entry.custom_title ?? 'Meal')}</h3>`;
        continue;
      }
      const meta = [
        recipe.servings ? `${recipe.servings} servings` : null,
        recipe.prep_minutes ? `prep ${recipe.prep_minutes} min` : null,
        recipe.cook_minutes ? `cook ${recipe.cook_minutes} min` : null,
      ].filter(Boolean);
      body += `<h3>${esc(recipe.title)}</h3>`;
      if (meta.length > 0) body += `<p class="meta">${esc(meta.join(' · '))}</p>`;
      const ingredients = (recipe.ingredients ?? [])
        .map((i) => i.raw || i.name || '')
        .filter(Boolean);
      if (ingredients.length > 0) {
        body += `<ul>${ingredients.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
      }
      if ((recipe.steps ?? []).length > 0) {
        body += `<ol>${recipe.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
      }
    }
  }

  return page(`Meals to cook — ${person.name}`, body);
});
