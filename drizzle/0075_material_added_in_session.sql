-- 0075_material_added_in_session.sql — which interview session added a material (spec 2026-11-19-interview-add-file).
-- Adds one nullable column; no data changes. Independent of 0074. Undo: ALTER TABLE course_materials DROP COLUMN added_in_session;
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = 'course_materials' AND column_name = 'added_in_session') THEN
    RAISE EXCEPTION '0075: already applied';
  END IF;
END $$;
ALTER TABLE course_materials ADD COLUMN added_in_session uuid REFERENCES capture_sessions(session_id) ON DELETE SET NULL;
COMMIT;
