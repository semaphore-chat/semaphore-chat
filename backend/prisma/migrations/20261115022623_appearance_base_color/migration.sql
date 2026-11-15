-- New appearance fields: an arbitrary base colour, "match system" and the
-- "new design" flag. Existing rows keep their look: their base is their own
-- accent's primary, so the old shell's nearest accent is the same accent.

ALTER TABLE "UserAppearanceSettings"
  ADD COLUMN "baseColor"   TEXT    NOT NULL DEFAULT '#8e75ff',
  ADD COLUMN "matchSystem" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "newDesign"   BOOLEAN NOT NULL DEFAULT false;

UPDATE "UserAppearanceSettings" SET "baseColor" = CASE "accentColor"
  WHEN 'teal' THEN '#0d9488' WHEN 'blue' THEN '#3b82f6' WHEN 'indigo' THEN '#6366f1'
  WHEN 'purple' THEN '#8b5cf6' WHEN 'rose' THEN '#f43f5e' WHEN 'red' THEN '#ef4444'
  WHEN 'orange' THEN '#f97316' WHEN 'amber' THEN '#f59e0b' WHEN 'lime' THEN '#84cc16'
  WHEN 'emerald' THEN '#10b981' WHEN 'cyan' THEN '#06b6d4' WHEN 'slate' THEN '#64748b'
  ELSE '#3b82f6' END;

ALTER TABLE "UserAppearanceSettings" ALTER COLUMN "accentColor" SET DEFAULT 'purple';
