-- 0023: per-person avatar color, chosen from the app's preset palette on the
-- person page and shown wherever the person's chip/avatar appears.

alter table persons add column avatar_color text;
