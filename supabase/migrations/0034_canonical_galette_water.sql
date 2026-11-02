-- FODMAP table gaps seen on real recipes: "4 pièces Galettes" (Breton
-- buckwheat galettes) and water lines never matched, so the low-FODMAP
-- check listed them as unverifiable. Galette → sarrasin (buckwheat, low);
-- water gets its own row (no carbohydrate, so no FODMAPs).

update canonical_ingredients
set aliases = aliases || array['galette', 'galette de sarrasin', 'galette ble noir',
                               'galette bretonne', 'crepe de sarrasin']
where slug = 'sarrasin' and not ('galette' = any(aliases));

insert into canonical_ingredients
  (slug, name_en, name_fr, name_es, name_it, aliases, category, aisle,
   fodmap_tier, fodmap_groups, density_g_per_ml, source_url, source_note,
   verified, fodmap_swaps)
values
  ('eau', 'water', 'eau', 'agua', 'acqua',
   array['eau tiede', 'eau froide', 'eau chaude', 'eau bouillante', 'water',
         'boiling water', 'cold water', 'warm water', 'aigua', 'aigua freda'],
   'pantry', null, 'low', '{}', 1,
   'https://fdc.nal.usda.gov/food-details/173647/nutrients',
   'Water contains no carbohydrate, so no FODMAPs (USDA FoodData Central).',
   false, '{}')
on conflict (slug) do nothing;

-- The LLM fallback cached "no match" for these lines; drop those rows so the
-- next load re-matches them against the new aliases.
delete from ingredient_matches
where canonical_id is null
  and raw_normalized in ('galette', 'eau', 'eau tiede', 'water', 'boiling water',
                         'cup water', 'aigua', 'aigua freda');
