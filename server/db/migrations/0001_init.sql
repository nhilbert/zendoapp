-- Zendo schema v1. One table per collection; each row keeps the record as JSON in `data`,
-- with generated columns for the fields worth indexing. See docs/architecture.md (ADR-1).
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) STORED
);
CREATE INDEX IF NOT EXISTS projects_status ON projects(status);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) STORED,
  project_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED,
  due_date TEXT GENERATED ALWAYS AS (json_extract(data, '$.dueDate')) STORED,
  planned_date TEXT GENERATED ALWAYS AS (json_extract(data, '$.plannedDate')) STORED
);
CREATE INDEX IF NOT EXISTS tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_project ON tasks(project_id);
CREATE INDEX IF NOT EXISTS tasks_due ON tasks(due_date);
CREATE INDEX IF NOT EXISTS tasks_planned ON tasks(planned_date);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  date TEXT GENERATED ALWAYS AS (json_extract(data, '$.date')) STORED,
  source TEXT GENERATED ALWAYS AS (json_extract(data, '$.source')) STORED,
  external_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.externalId')) STORED
);
CREATE INDEX IF NOT EXISTS events_date ON events(date);
CREATE INDEX IF NOT EXISTS events_source ON events(source);

CREATE TABLE IF NOT EXISTS plan_blocks (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  date TEXT GENERATED ALWAYS AS (json_extract(data, '$.date')) STORED,
  project_id TEXT GENERATED ALWAYS AS (json_extract(data, '$.projectId')) STORED
);
CREATE INDEX IF NOT EXISTS plan_blocks_date ON plan_blocks(date);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  kind TEXT GENERATED ALWAYS AS (json_extract(data, '$.kind')) STORED,
  date TEXT GENERATED ALWAYS AS (json_extract(data, '$.date')) STORED
);
CREATE INDEX IF NOT EXISTS reviews_kind_date ON reviews(kind, date);

CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
