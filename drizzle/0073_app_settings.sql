-- 0073_app_settings.sql — small operator settings that aren't per AI function (spec 2026-11-20-settings-evidence).
-- First key: 'search.rerank' = 'on' | 'off' (no row = follow the RERANK env switch).
-- Creates one table; no existing table or row is touched. Undo: DROP TABLE app_settings;
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
