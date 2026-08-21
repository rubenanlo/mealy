-- Part 4: free X/Y focal point for the hero cover (null = centered).
alter table recipes add column if not exists cover_focal jsonb;
