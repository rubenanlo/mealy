-- FODMAP swaps (2026-08-24): deterministic low-FODMAP alternates per
-- Monash's public high/low food list; slugs reference this same table.

alter table canonical_ingredients
  add column fodmap_swaps text[] not null default '{}';

update canonical_ingredients set fodmap_swaps = '{orange,ananas}' where slug = 'abricot';
update canonical_ingredients set fodmap_swaps = '{myrtille,ananas}' where slug = 'abricot-sec';
update canonical_ingredients set fodmap_swaps = '{ciboulette}' where slug = 'ail';
update canonical_ingredients set fodmap_swaps = '{cacahuete,noix}' where slug = 'amande';
update canonical_ingredients set fodmap_swaps = '{haricot-vert,aubergine}' where slug = 'artichaut';
update canonical_ingredients set fodmap_swaps = '{haricot-vert,courgette}' where slug = 'asperge';
update canonical_ingredients set fodmap_swaps = '{pain-epeautre-levain}' where slug = 'baguette';
update canonical_ingredients set fodmap_swaps = '{carotte,radis}' where slug = 'betterave';
update canonical_ingredients set fodmap_swaps = '{quinoa,sarrasin}' where slug = 'boulgour';
update canonical_ingredients set fodmap_swaps = '{concombre,radis}' where slug = 'celeri-branche';
update canonical_ingredients set fodmap_swaps = '{myrtille,fraise}' where slug = 'cerise';
update canonical_ingredients set fodmap_swaps = '{pleurote}' where slug = 'champignon-de-paris';
update canonical_ingredients set fodmap_swaps = '{brocoli,chou-kale}' where slug = 'chou-de-bruxelles';
update canonical_ingredients set fodmap_swaps = '{brocoli,chou-blanc}' where slug = 'chou-fleur';
update canonical_ingredients set fodmap_swaps = '{potimarron,patate-douce}' where slug = 'courge-butternut';
update canonical_ingredients set fodmap_swaps = '{oignon-nouveau,ciboulette}' where slug = 'echalote';
update canonical_ingredients set fodmap_swaps = '{sarrasin,flocons-avoine}' where slug = 'farine-ble';
update canonical_ingredients set fodmap_swaps = '{courgette,poivron-vert}' where slug = 'fenouil';
update canonical_ingredients set fodmap_swaps = '{tofu-ferme,haricot-vert}' where slug = 'flageolet';
update canonical_ingredients set fodmap_swaps = '{tofu-ferme,quinoa}' where slug = 'haricot-blanc';
update canonical_ingredients set fodmap_swaps = '{tofu-ferme,quinoa}' where slug = 'haricot-rouge';
update canonical_ingredients set fodmap_swaps = '{moutarde,sauce-tomate}' where slug = 'ketchup';
update canonical_ingredients set fodmap_swaps = '{lait-sans-lactose,lait-coco}' where slug = 'lait';
update canonical_ingredients set fodmap_swaps = '{quinoa,tofu-ferme}' where slug = 'lentille-corail';
update canonical_ingredients set fodmap_swaps = '{quinoa,tofu-ferme}' where slug = 'lentille-verte';
update canonical_ingredients set fodmap_swaps = '{patate-douce,carotte}' where slug = 'mais-doux';
update canonical_ingredients set fodmap_swaps = '{ananas,melon}' where slug = 'mangue';
update canonical_ingredients set fodmap_swaps = '{sirop-erable,sucre}' where slug = 'miel';
update canonical_ingredients set fodmap_swaps = '{orange,myrtille}' where slug = 'nectarine';
update canonical_ingredients set fodmap_swaps = '{cacahuete,noix}' where slug = 'noisette';
update canonical_ingredients set fodmap_swaps = '{cacahuete,noix}' where slug = 'noix-cajou';
update canonical_ingredients set fodmap_swaps = '{oignon-nouveau,ciboulette}' where slug = 'oignon';
update canonical_ingredients set fodmap_swaps = '{oignon-nouveau,ciboulette}' where slug = 'oignon-rouge';
update canonical_ingredients set fodmap_swaps = '{pain-epeautre-levain}' where slug = 'pain-complet';
update canonical_ingredients set fodmap_swaps = '{pain-epeautre-levain}' where slug = 'pain-de-mie';
update canonical_ingredients set fodmap_swaps = '{melon,fraise}' where slug = 'pasteque';
update canonical_ingredients set fodmap_swaps = '{riz,quinoa}' where slug = 'pates-ble';
update canonical_ingredients set fodmap_swaps = '{orange,myrtille}' where slug = 'peche';
update canonical_ingredients set fodmap_swaps = '{haricot-vert}' where slug = 'petit-pois';
update canonical_ingredients set fodmap_swaps = '{cacahuete,noix}' where slug = 'pistache';
update canonical_ingredients set fodmap_swaps = '{myrtille,kiwi}' where slug = 'poire';
update canonical_ingredients set fodmap_swaps = '{oignon-nouveau}' where slug = 'poireau';
update canonical_ingredients set fodmap_swaps = '{tofu-ferme,quinoa}' where slug = 'pois-chiche';
update canonical_ingredients set fodmap_swaps = '{poivron-vert}' where slug = 'poivron-rouge';
update canonical_ingredients set fodmap_swaps = '{kiwi,orange}' where slug = 'pomme';
update canonical_ingredients set fodmap_swaps = '{myrtille,orange}' where slug = 'prune';
update canonical_ingredients set fodmap_swaps = '{raisin,myrtille}' where slug = 'raisin-sec';
update canonical_ingredients set fodmap_swaps = '{feta,brie}' where slug = 'ricotta';
update canonical_ingredients set fodmap_swaps = '{quinoa,polenta}' where slug = 'semoule-couscous';
update canonical_ingredients set fodmap_swaps = '{lait-sans-lactose}' where slug = 'yaourt-nature';
