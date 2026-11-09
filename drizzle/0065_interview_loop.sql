-- 0065_interview_loop.sql — which loop runs the faculty interview
-- (Pi plan Task 5, 2026-11-09): ai_function_settings.loop on the
-- capture-chat-agent row; NULL means the current loop. Flipping it back is the rollback.
-- Live order: backup -> apply (this file) -> verify the column -> deploy the build.
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'ai_function_settings' AND column_name = 'loop') THEN
    RAISE EXCEPTION '0065: already applied';
  END IF;
END $$;
ALTER TABLE ai_function_settings ADD COLUMN loop text NULL CHECK (loop IN ('current', 'pi'));
COMMIT;
