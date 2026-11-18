-- The "Orçamento" button/status becomes a default funnel stage.
-- (SQLite's NOCASE ignores case only for ASCII, so the Ç spelling is listed on its own.)
-- 1) every client gets an "Orçamento" stage (kept if they already made one with that name);
-- 2) contacts that were in status 'orcamento' go back to 'aberto' and into that stage.
-- status_at is left as it was: the open window counts from it, so a pending quote does not drop off the list.
INSERT INTO `funnel_stages` (`client_id`, `name`, `position`, `created_at`)
SELECT c.`id`,
       'Orçamento',
       COALESCE((SELECT MAX(f.`position`) + 1 FROM `funnel_stages` f WHERE f.`client_id` = c.`id`), 0),
       CAST(strftime('%s', 'now') AS integer) * 1000
FROM `clients` c
WHERE NOT EXISTS (
  SELECT 1 FROM `funnel_stages` f WHERE f.`client_id` = c.`id` AND f.`name` COLLATE NOCASE IN ('Orçamento', 'ORÇAMENTO')
);
--> statement-breakpoint
UPDATE `contacts`
SET `stage_id` = (
      SELECT f.`id` FROM `funnel_stages` f
      WHERE f.`client_id` = `contacts`.`client_id` AND f.`name` COLLATE NOCASE IN ('Orçamento', 'ORÇAMENTO')
      ORDER BY f.`position` LIMIT 1
    ),
    `status` = 'aberto'
WHERE `status` = 'orcamento';
