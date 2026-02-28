const Database = require('better-sqlite3');

function requiredText(value, fieldName) {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed) {
    throw new Error(`${fieldName} is required`);
  }
  return parsed;
}

function optionalText(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const parsed = value.trim();
  return parsed.length ? parsed : null;
}

function textArray(value, fieldName) {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }
    const parsed = item.trim();
    if (!parsed) {
      continue;
    }
    const key = parsed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(parsed);
  }

  if (unique.length > 32) {
    throw new Error(`${fieldName} has too many entries`);
  }

  return unique;
}

function parseJsonArray(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function positiveInt(value, fieldName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeNumber(value, fieldName) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${fieldName} must be a non-negative number`);
  }
  return parsed;
}

function optionalPositiveInt(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }
  return parsed;
}

function optionalNonNegativeNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

class LoglyDatabase {
  constructor(dbFilePath) {
    this.db = new Database(dbFilePath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.seedDefaults();
    this.prepareStatements();
    this.backfillGlobalExerciseTags();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS exercise_variations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        grip TEXT,
        stance TEXT,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(exercise_id, name),
        FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS exercise_categories (
        exercise_id INTEGER NOT NULL,
        category_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (exercise_id, category_id),
        FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS group_exercises (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        exercise_id INTEGER NOT NULL,
        variation_id INTEGER,
        target_sets INTEGER NOT NULL DEFAULT 3,
        target_reps TEXT,
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE,
        FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
        FOREIGN KEY (variation_id) REFERENCES exercise_variations(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL,
        performed_on TEXT NOT NULL,
        notes TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        finished_at TEXT,
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE RESTRICT
      );

      CREATE TABLE IF NOT EXISTS workout_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_id INTEGER NOT NULL,
        group_exercise_id INTEGER NOT NULL,
        set_number INTEGER NOT NULL,
        reps INTEGER NOT NULL,
        weight REAL NOT NULL DEFAULT 0,
        rpe REAL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE,
        FOREIGN KEY (group_exercise_id) REFERENCES group_exercises(id) ON DELETE RESTRICT,
        UNIQUE(workout_id, group_exercise_id, set_number)
      );

      CREATE TABLE IF NOT EXISTS daily_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        performed_on TEXT NOT NULL,
        exercise_id INTEGER NOT NULL,
        selected_tags TEXT NOT NULL DEFAULT '[]',
        order_index INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(performed_on, exercise_id),
        FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS daily_log_sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        daily_log_id INTEGER NOT NULL,
        set_number INTEGER NOT NULL,
        reps INTEGER,
        weight REAL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(daily_log_id, set_number),
        FOREIGN KEY (daily_log_id) REFERENCES daily_logs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS calories_targets (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        target_kcal REAL NOT NULL DEFAULT 2200,
        target_protein REAL NOT NULL DEFAULT 150,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS calories_food_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        consumed_on TEXT NOT NULL,
        food_id TEXT NOT NULL,
        title TEXT NOT NULL,
        grams REAL NOT NULL,
        kcal REAL NOT NULL DEFAULT 0,
        protein REAL NOT NULL DEFAULT 0,
        image_url TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS personal_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        exercise_id INTEGER NOT NULL,
        variation_id INTEGER,
        variation_key INTEGER NOT NULL DEFAULT 0,
        record_type TEXT NOT NULL,
        value REAL NOT NULL,
        achieved_on TEXT NOT NULL,
        workout_set_id INTEGER NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
        FOREIGN KEY (variation_id) REFERENCES exercise_variations(id) ON DELETE SET NULL,
        FOREIGN KEY (workout_set_id) REFERENCES workout_sets(id) ON DELETE CASCADE,
        UNIQUE(exercise_id, variation_key, record_type)
      );

      CREATE TABLE IF NOT EXISTS exercise_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_group_exercises_group ON group_exercises(group_id, order_index);
      CREATE INDEX IF NOT EXISTS idx_workouts_group ON workouts(group_id, performed_on);
      CREATE INDEX IF NOT EXISTS idx_workout_sets_workout ON workout_sets(workout_id, group_exercise_id, set_number);
      CREATE INDEX IF NOT EXISTS idx_daily_logs_date ON daily_logs(performed_on, order_index);
      CREATE INDEX IF NOT EXISTS idx_daily_log_sets_log ON daily_log_sets(daily_log_id, set_number);
      CREATE INDEX IF NOT EXISTS idx_pr_exercise ON personal_records(exercise_id, variation_key, record_type);
      CREATE INDEX IF NOT EXISTS idx_exercise_tags_name ON exercise_tags(name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS idx_calories_food_logs_day ON calories_food_logs(consumed_on, id DESC);
    `);

    this.ensureColumn('exercises', 'equipment', "TEXT NOT NULL DEFAULT 'bodyweight'");
    this.ensureColumn('exercises', 'muscle_groups', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('exercises', 'suboptions', "TEXT NOT NULL DEFAULT '[]'");
    this.ensureColumn('daily_logs', 'selected_tags', "TEXT NOT NULL DEFAULT '[]'");
  }

  ensureColumn(tableName, columnName, definition) {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all();
    if (columns.some((column) => column.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }

  seedDefaults() {
    this.db.prepare(`
      INSERT OR IGNORE INTO calories_targets (id, target_kcal, target_protein)
      VALUES (1, 2200, 150)
    `).run();

    const count = this.db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
    if (count > 0) {
      return;
    }

    const insert = this.db.prepare('INSERT INTO categories (name) VALUES (?)');
    const defaults = ['Push Day', 'Pull Day', 'Leg Day', 'Upper', 'Lower', 'Full Body'];

    const tx = this.db.transaction(() => {
      for (const category of defaults) {
        insert.run(category);
      }
    });

    tx();
  }

  prepareStatements() {
    this.stmt = {
      createCategory: this.db.prepare('INSERT INTO categories (name) VALUES (?)'),
      listCategories: this.db.prepare('SELECT id, name, created_at FROM categories ORDER BY name ASC'),

      createExercise: this.db.prepare(`
        INSERT INTO exercises (name, type, notes, equipment, muscle_groups, suboptions)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      upsertExerciseTag: this.db.prepare(`
        INSERT OR IGNORE INTO exercise_tags (name)
        VALUES (?)
      `),
      getExerciseTagByName: this.db.prepare(`
        SELECT id, name, created_at
        FROM exercise_tags
        WHERE name = ? COLLATE NOCASE
        LIMIT 1
      `),
      listExerciseTags: this.db.prepare(`
        SELECT id, name, created_at
        FROM exercise_tags
        ORDER BY name COLLATE NOCASE ASC
      `),
      listExerciseSuboptionsRaw: this.db.prepare(`
        SELECT id, suboptions
        FROM exercises
        WHERE suboptions IS NOT NULL AND TRIM(suboptions) <> ''
      `),
      deleteExerciseTag: this.db.prepare(`
        DELETE FROM exercise_tags
        WHERE name = ? COLLATE NOCASE
      `),
      updateExerciseSuboptionsById: this.db.prepare(`
        UPDATE exercises
        SET suboptions = ?
        WHERE id = ?
      `),
      updateExercise: this.db.prepare(`
        UPDATE exercises
        SET name = ?, type = ?, notes = ?, equipment = ?, muscle_groups = ?, suboptions = ?
        WHERE id = ?
      `),
      deleteExercise: this.db.prepare('DELETE FROM exercises WHERE id = ?'),
      listExercises: this.db.prepare(`
        SELECT
          e.id,
          e.name,
          e.type,
          e.notes,
          e.equipment,
          e.muscle_groups,
          e.suboptions,
          e.created_at,
          COALESCE(GROUP_CONCAT(DISTINCT c.name), '') AS categories
        FROM exercises e
        LEFT JOIN exercise_categories ec ON ec.exercise_id = e.id
        LEFT JOIN categories c ON c.id = ec.category_id
        GROUP BY e.id
        ORDER BY e.name ASC
      `),
      listVariationsByExercise: this.db.prepare(`
        SELECT id, exercise_id, name, grip, stance, notes, created_at
        FROM exercise_variations
        WHERE exercise_id = ?
        ORDER BY name ASC
      `),
      getVariationById: this.db.prepare(`
        SELECT id, exercise_id
        FROM exercise_variations
        WHERE id = ?
      `),
      addExerciseCategory: this.db.prepare(`
        INSERT OR IGNORE INTO exercise_categories (exercise_id, category_id)
        VALUES (?, ?)
      `),
      createVariation: this.db.prepare(`
        INSERT INTO exercise_variations (exercise_id, name, grip, stance, notes)
        VALUES (?, ?, ?, ?, ?)
      `),

      createGroup: this.db.prepare('INSERT INTO groups (name, description) VALUES (?, ?)'),
      listGroups: this.db.prepare('SELECT id, name, description, created_at FROM groups ORDER BY name ASC'),
      getGroup: this.db.prepare('SELECT id, name, description, created_at FROM groups WHERE id = ?'),
      deleteWorkoutSetsByGroupId: this.db.prepare(`
        DELETE FROM workout_sets
        WHERE workout_id IN (
          SELECT id
          FROM workouts
          WHERE group_id = ?
        )
      `),
      deleteWorkoutsByGroupId: this.db.prepare(`
        DELETE FROM workouts
        WHERE group_id = ?
      `),
      deleteGroupExercisesByGroupId: this.db.prepare(`
        DELETE FROM group_exercises
        WHERE group_id = ?
      `),
      deleteGroupById: this.db.prepare(`
        DELETE FROM groups
        WHERE id = ?
      `),
      listGroupExercises: this.db.prepare(`
        SELECT
          ge.id,
          ge.group_id,
          ge.exercise_id,
          ge.variation_id,
          ge.target_sets,
          ge.target_reps,
          ge.order_index,
          e.name AS exercise_name,
          e.type AS exercise_type,
          ev.name AS variation_name,
          ev.grip,
          ev.stance
        FROM group_exercises ge
        JOIN exercises e ON e.id = ge.exercise_id
        LEFT JOIN exercise_variations ev ON ev.id = ge.variation_id
        WHERE ge.group_id = ?
        ORDER BY ge.order_index ASC, ge.id ASC
      `),
      nextOrderIndexForGroup: this.db.prepare(`
        SELECT COALESCE(MAX(order_index), 0) + 1 AS next_order
        FROM group_exercises
        WHERE group_id = ?
      `),
      addGroupExercise: this.db.prepare(`
        INSERT INTO group_exercises (group_id, exercise_id, variation_id, target_sets, target_reps, order_index)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      removeGroupExercise: this.db.prepare('DELETE FROM group_exercises WHERE id = ?'),

      startWorkout: this.db.prepare(`
        INSERT INTO workouts (group_id, performed_on, notes, status)
        VALUES (?, ?, ?, 'active')
      `),
      finishWorkout: this.db.prepare(`
        UPDATE workouts
        SET status = 'finished', finished_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `),
      getWorkoutById: this.db.prepare(`
        SELECT
          w.id,
          w.group_id,
          w.performed_on,
          w.notes,
          w.status,
          w.started_at,
          w.finished_at,
          g.name AS group_name
        FROM workouts w
        JOIN groups g ON g.id = w.group_id
        WHERE w.id = ?
      `),
      listWorkouts: this.db.prepare(`
        SELECT
          w.id,
          w.group_id,
          w.performed_on,
          w.status,
          w.started_at,
          w.finished_at,
          g.name AS group_name
        FROM workouts w
        JOIN groups g ON g.id = w.group_id
        ORDER BY w.id DESC
        LIMIT ?
      `),
      listActiveWorkouts: this.db.prepare(`
        SELECT
          w.id,
          w.group_id,
          w.performed_on,
          w.status,
          g.name AS group_name
        FROM workouts w
        JOIN groups g ON g.id = w.group_id
        WHERE w.status = 'active'
        ORDER BY w.started_at DESC
      `),
      nextSetNumber: this.db.prepare(`
        SELECT COALESCE(MAX(set_number), 0) + 1 AS next_set
        FROM workout_sets
        WHERE workout_id = ? AND group_exercise_id = ?
      `),
      createWorkoutSet: this.db.prepare(`
        INSERT INTO workout_sets (workout_id, group_exercise_id, set_number, reps, weight, rpe, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      getWorkoutSets: this.db.prepare(`
        SELECT
          ws.id,
          ws.workout_id,
          ws.group_exercise_id,
          ws.set_number,
          ws.reps,
          ws.weight,
          ws.rpe,
          ws.notes,
          ws.created_at,
          e.id AS exercise_id,
          e.name AS exercise_name,
          ev.id AS variation_id,
          ev.name AS variation_name
        FROM workout_sets ws
        JOIN group_exercises ge ON ge.id = ws.group_exercise_id
        JOIN exercises e ON e.id = ge.exercise_id
        LEFT JOIN exercise_variations ev ON ev.id = ge.variation_id
        WHERE ws.workout_id = ?
        ORDER BY ws.group_exercise_id ASC, ws.set_number ASC
      `),
      getGroupExerciseById: this.db.prepare(`
        SELECT
          ge.id,
          ge.exercise_id,
          ge.variation_id,
          ge.group_id,
          e.name AS exercise_name,
          ev.name AS variation_name
        FROM group_exercises ge
        JOIN exercises e ON e.id = ge.exercise_id
        LEFT JOIN exercise_variations ev ON ev.id = ge.variation_id
        WHERE ge.id = ?
      `),
      getWorkoutDate: this.db.prepare('SELECT performed_on FROM workouts WHERE id = ?'),
      getWorkoutForSetLogging: this.db.prepare(`
        SELECT
          w.id,
          w.group_id,
          w.status,
          ge.group_id AS group_exercise_group_id
        FROM workouts w
        JOIN group_exercises ge ON ge.id = ?
        WHERE w.id = ?
      `),
      listDailyLogsByDate: this.db.prepare(`
        SELECT
          dl.id,
          dl.performed_on,
          dl.exercise_id,
          dl.selected_tags,
          dl.order_index,
          e.name AS exercise_name,
          e.muscle_groups,
          e.suboptions
        FROM daily_logs dl
        JOIN exercises e ON e.id = dl.exercise_id
        WHERE dl.performed_on = ?
        ORDER BY dl.order_index ASC, dl.id ASC
      `),
      listDailyLogSetsByLogId: this.db.prepare(`
        SELECT
          set_number,
          reps,
          weight
        FROM daily_log_sets
        WHERE daily_log_id = ?
        ORDER BY set_number ASC
      `),
      deleteDailyLogsByDate: this.db.prepare(`
        DELETE FROM daily_logs
        WHERE performed_on = ?
      `),
      insertDailyLog: this.db.prepare(`
        INSERT INTO daily_logs (performed_on, exercise_id, selected_tags, order_index)
        VALUES (?, ?, ?, ?)
      `),
      insertDailyLogSet: this.db.prepare(`
        INSERT INTO daily_log_sets (daily_log_id, set_number, reps, weight)
        VALUES (?, ?, ?, ?)
      `),
      listAnalyticsRowsByExerciseRange: this.db.prepare(`
        SELECT
          dl.id AS daily_log_id,
          dl.performed_on,
          dl.selected_tags,
          dls.reps,
          dls.weight
        FROM daily_logs dl
        LEFT JOIN daily_log_sets dls ON dls.daily_log_id = dl.id
        WHERE dl.exercise_id = ?
          AND dl.performed_on >= ?
          AND dl.performed_on <= ?
        ORDER BY dl.performed_on ASC, dls.set_number ASC
      `),
      getCaloriesTargets: this.db.prepare(`
        SELECT
          target_kcal,
          target_protein,
          updated_at
        FROM calories_targets
        WHERE id = 1
        LIMIT 1
      `),
      upsertCaloriesTargets: this.db.prepare(`
        INSERT INTO calories_targets (id, target_kcal, target_protein, updated_at)
        VALUES (1, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          target_kcal = excluded.target_kcal,
          target_protein = excluded.target_protein,
          updated_at = CURRENT_TIMESTAMP
      `),
      insertCaloriesFoodLog: this.db.prepare(`
        INSERT INTO calories_food_logs (
          consumed_on,
          food_id,
          title,
          grams,
          kcal,
          protein,
          image_url
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `),
      listCaloriesFoodLogsByDate: this.db.prepare(`
        SELECT
          id,
          consumed_on,
          food_id,
          title,
          grams,
          kcal,
          protein,
          image_url,
          created_at
        FROM calories_food_logs
        WHERE consumed_on = ?
        ORDER BY id DESC
      `),
      deleteCaloriesFoodLogById: this.db.prepare(`
        DELETE FROM calories_food_logs
        WHERE id = ? AND consumed_on = ?
      `),
      getCaloriesFoodTotalsByDate: this.db.prepare(`
        SELECT
          COALESCE(SUM(kcal), 0) AS kcal_sum,
          COALESCE(SUM(protein), 0) AS protein_sum
        FROM calories_food_logs
        WHERE consumed_on = ?
      `),
      getCaloriesFoodTotalsByRange: this.db.prepare(`
        SELECT
          consumed_on,
          COALESCE(SUM(kcal), 0) AS kcal_sum,
          COALESCE(SUM(protein), 0) AS protein_sum
        FROM calories_food_logs
        WHERE consumed_on >= ?
          AND consumed_on <= ?
        GROUP BY consumed_on
        ORDER BY consumed_on ASC
      `),

      upsertRecord: this.db.prepare(`
        INSERT INTO personal_records (
          exercise_id,
          variation_id,
          variation_key,
          record_type,
          value,
          achieved_on,
          workout_set_id,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(exercise_id, variation_key, record_type)
        DO UPDATE SET
          value = excluded.value,
          achieved_on = excluded.achieved_on,
          workout_set_id = excluded.workout_set_id,
          updated_at = CURRENT_TIMESTAMP
        WHERE excluded.value > personal_records.value
      `),
      getPersonalRecords: this.db.prepare(`
        SELECT
          pr.id,
          pr.exercise_id,
          pr.variation_id,
          pr.record_type,
          pr.value,
          pr.achieved_on,
          pr.updated_at,
          e.name AS exercise_name,
          ev.name AS variation_name
        FROM personal_records pr
        JOIN exercises e ON e.id = pr.exercise_id
        LEFT JOIN exercise_variations ev ON ev.id = pr.variation_id
        ORDER BY e.name ASC, pr.record_type ASC
      `),
      getPersonalRecordsByExercise: this.db.prepare(`
        SELECT
          pr.id,
          pr.exercise_id,
          pr.variation_id,
          pr.record_type,
          pr.value,
          pr.achieved_on,
          pr.updated_at,
          e.name AS exercise_name,
          ev.name AS variation_name
        FROM personal_records pr
        JOIN exercises e ON e.id = pr.exercise_id
        LEFT JOIN exercise_variations ev ON ev.id = pr.variation_id
        WHERE pr.exercise_id = ?
        ORDER BY pr.record_type ASC
      `),
      getRecentSets: this.db.prepare(`
        SELECT
          ws.id,
          ws.set_number,
          ws.reps,
          ws.weight,
          ws.rpe,
          w.performed_on,
          g.name AS group_name,
          e.id AS exercise_id,
          e.name AS exercise_name,
          ev.name AS variation_name
        FROM workout_sets ws
        JOIN workouts w ON w.id = ws.workout_id
        JOIN groups g ON g.id = w.group_id
        JOIN group_exercises ge ON ge.id = ws.group_exercise_id
        JOIN exercises e ON e.id = ge.exercise_id
        LEFT JOIN exercise_variations ev ON ev.id = ge.variation_id
        ORDER BY ws.id DESC
        LIMIT ?
      `),
      getRecentSetsByExercise: this.db.prepare(`
        SELECT
          ws.id,
          ws.set_number,
          ws.reps,
          ws.weight,
          ws.rpe,
          w.performed_on,
          g.name AS group_name,
          e.id AS exercise_id,
          e.name AS exercise_name,
          ev.name AS variation_name
        FROM workout_sets ws
        JOIN workouts w ON w.id = ws.workout_id
        JOIN groups g ON g.id = w.group_id
        JOIN group_exercises ge ON ge.id = ws.group_exercise_id
        JOIN exercises e ON e.id = ge.exercise_id
        LEFT JOIN exercise_variations ev ON ev.id = ge.variation_id
        WHERE e.id = ?
        ORDER BY ws.id DESC
        LIMIT ?
      `),
      dashboard: this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM exercises) AS exercises_count,
          (SELECT COUNT(*) FROM groups) AS groups_count,
          (SELECT COUNT(*) FROM workouts) AS workouts_count,
          (SELECT COUNT(*) FROM personal_records) AS records_count
      `)
    };
  }

  createCategory(payload) {
    const name = requiredText(payload?.name, 'Category name');
    const result = this.stmt.createCategory.run(name);
    return { id: result.lastInsertRowid, name };
  }

  listCategories() {
    return this.stmt.listCategories.all();
  }

  createExerciseTag(payload) {
    const name = requiredText(payload?.name, 'Tag name');
    this.saveGlobalExerciseTags([name]);
    return this.stmt.getExerciseTagByName.get(name) || { id: null, name };
  }

  saveGlobalExerciseTags(tagNames) {
    const tags = textArray(tagNames, 'Sub-options');
    if (!tags.length) {
      return;
    }

    const tx = this.db.transaction((items) => {
      for (const tag of items) {
        this.stmt.upsertExerciseTag.run(tag);
      }
    });

    tx(tags);
  }

  backfillGlobalExerciseTags() {
    const rows = this.stmt.listExerciseSuboptionsRaw.all();
    if (!rows.length) {
      return;
    }

    const tags = [];
    for (const row of rows) {
      tags.push(...parseJsonArray(row.suboptions));
    }
    this.saveGlobalExerciseTags(tags);
  }

  createExercise(payload) {
    const name = requiredText(payload?.name, 'Exercise name');
    const type = requiredText(payload?.type, 'Exercise type');
    const notes = optionalText(payload?.notes);
    const equipment = optionalText(payload?.equipment) || 'bodyweight';
    const muscleGroups = textArray(payload?.muscleGroups, 'Muscle groups');
    const suboptions = textArray(payload?.suboptions, 'Sub-options');

    const result = this.stmt.createExercise.run(
      name,
      type,
      notes,
      equipment,
      JSON.stringify(muscleGroups),
      JSON.stringify(suboptions)
    );
    this.saveGlobalExerciseTags(suboptions);

    return {
      id: result.lastInsertRowid,
      name,
      type,
      notes,
      equipment,
      muscle_groups: muscleGroups,
      suboptions
    };
  }

  updateExercise(payload) {
    const exerciseId = positiveInt(payload?.exerciseId, 'Exercise ID');
    const name = requiredText(payload?.name, 'Exercise name');
    const type = optionalText(payload?.type) || 'general';
    const notes = optionalText(payload?.notes);
    const equipment = optionalText(payload?.equipment) || 'bodyweight';
    const muscleGroups = textArray(payload?.muscleGroups, 'Muscle groups');
    const suboptions = textArray(payload?.suboptions, 'Sub-options');

    const result = this.stmt.updateExercise.run(
      name,
      type,
      notes,
      equipment,
      JSON.stringify(muscleGroups),
      JSON.stringify(suboptions),
      exerciseId
    );
    this.saveGlobalExerciseTags(suboptions);

    if (result.changes === 0) {
      throw new Error('Exercise not found');
    }

    return {
      id: exerciseId,
      name,
      type,
      notes,
      equipment,
      muscle_groups: muscleGroups,
      suboptions
    };
  }

  deleteExercise(payload) {
    const exerciseId = positiveInt(payload?.exerciseId, 'Exercise ID');
    const result = this.stmt.deleteExercise.run(exerciseId);
    if (result.changes === 0) {
      throw new Error('Exercise not found');
    }
    return { ok: true };
  }

  listExercises() {
    const rows = this.stmt.listExercises.all();
    return rows.map((row) => ({
      ...row,
      muscle_groups: parseJsonArray(row.muscle_groups),
      suboptions: parseJsonArray(row.suboptions),
      category_names: row.categories ? row.categories.split(',') : [],
      variations: this.stmt.listVariationsByExercise.all(row.id)
    }));
  }

  listExerciseTags() {
    return this.stmt.listExerciseTags.all();
  }

  deleteExerciseTag(payload) {
    const name = requiredText(payload?.name, 'Tag name');
    const tagKey = name.toLowerCase();
    const rows = this.stmt.listExerciseSuboptionsRaw.all();

    const tx = this.db.transaction(() => {
      this.stmt.deleteExerciseTag.run(name);

      for (const row of rows) {
        const current = parseJsonArray(row.suboptions);
        if (!current.length) {
          continue;
        }

        const filtered = current.filter((value) => value.toLowerCase() !== tagKey);
        if (filtered.length !== current.length) {
          this.stmt.updateExerciseSuboptionsById.run(JSON.stringify(filtered), row.id);
        }
      }
    });

    tx();
    return { ok: true };
  }

  assignCategoryToExercise(payload) {
    const exerciseId = positiveInt(payload?.exerciseId, 'Exercise ID');
    const categoryId = positiveInt(payload?.categoryId, 'Category ID');
    this.stmt.addExerciseCategory.run(exerciseId, categoryId);
    return { ok: true };
  }

  createVariation(payload) {
    const exerciseId = positiveInt(payload?.exerciseId, 'Exercise ID');
    const name = requiredText(payload?.name, 'Variation name');
    const grip = optionalText(payload?.grip);
    const stance = optionalText(payload?.stance);
    const notes = optionalText(payload?.notes);
    const result = this.stmt.createVariation.run(exerciseId, name, grip, stance, notes);
    return { id: result.lastInsertRowid, exercise_id: exerciseId, name, grip, stance, notes };
  }

  createGroup(payload) {
    const name = requiredText(payload?.name, 'Group name');
    const description = optionalText(payload?.description);
    const result = this.stmt.createGroup.run(name, description);
    return { id: result.lastInsertRowid, name, description };
  }

  listGroups() {
    return this.stmt.listGroups.all();
  }

  deleteGroup(payload) {
    const groupId = positiveInt(payload?.groupId, 'Group ID');
    const group = this.stmt.getGroup.get(groupId);
    if (!group) {
      throw new Error('Template not found');
    }

    const tx = this.db.transaction(() => {
      this.stmt.deleteWorkoutSetsByGroupId.run(groupId);
      this.stmt.deleteWorkoutsByGroupId.run(groupId);
      this.stmt.deleteGroupExercisesByGroupId.run(groupId);
      this.stmt.deleteGroupById.run(groupId);
    });

    tx();
    return { ok: true, groupId };
  }

  clearAllTemplatesData() {
    const tx = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM workout_sets;
        DELETE FROM workouts;
        DELETE FROM group_exercises;
        DELETE FROM groups;
      `);
    });

    tx();
    return { ok: true };
  }

  addGroupExercise(payload) {
    const groupId = positiveInt(payload?.groupId, 'Group ID');
    const exerciseId = positiveInt(payload?.exerciseId, 'Exercise ID');
    const variationId = payload?.variationId ? positiveInt(payload.variationId, 'Variation ID') : null;
    const targetSets = payload?.targetSets ? positiveInt(payload.targetSets, 'Target sets') : 3;
    const targetReps = optionalText(payload?.targetReps);

    if (variationId) {
      const variation = this.stmt.getVariationById.get(variationId);
      if (!variation) {
        throw new Error('Variation not found');
      }
      if (variation.exercise_id !== exerciseId) {
        throw new Error('Variation does not belong to selected exercise');
      }
    }

    const orderIndex = payload?.orderIndex
      ? positiveInt(payload.orderIndex, 'Order index')
      : this.stmt.nextOrderIndexForGroup.get(groupId).next_order;

    const result = this.stmt.addGroupExercise.run(
      groupId,
      exerciseId,
      variationId,
      targetSets,
      targetReps,
      orderIndex
    );

    return { id: result.lastInsertRowid };
  }

  removeGroupExercise(payload) {
    const groupExerciseId = positiveInt(payload?.groupExerciseId, 'Group exercise ID');
    this.stmt.removeGroupExercise.run(groupExerciseId);
    return { ok: true };
  }

  getGroupDetails(payload) {
    const groupId = positiveInt(payload?.groupId, 'Group ID');
    const group = this.stmt.getGroup.get(groupId);
    if (!group) {
      throw new Error('Group not found');
    }
    const items = this.stmt.listGroupExercises.all(groupId);
    return { group, items };
  }

  startWorkout(payload) {
    const groupId = positiveInt(payload?.groupId, 'Group ID');
    const performedOn = requiredText(payload?.performedOn, 'Workout date');
    const notes = optionalText(payload?.notes);
    const result = this.stmt.startWorkout.run(groupId, performedOn, notes);
    return this.getWorkoutDetails({ workoutId: result.lastInsertRowid });
  }

  finishWorkout(payload) {
    const workoutId = positiveInt(payload?.workoutId, 'Workout ID');
    this.stmt.finishWorkout.run(workoutId);
    return this.getWorkoutDetails({ workoutId });
  }

  listWorkouts(payload) {
    const limit = payload?.limit ? positiveInt(payload.limit, 'Limit') : 30;
    return this.stmt.listWorkouts.all(limit);
  }

  listActiveWorkouts() {
    return this.stmt.listActiveWorkouts.all();
  }

  getWorkoutDetails(payload) {
    const workoutId = positiveInt(payload?.workoutId, 'Workout ID');
    const workout = this.stmt.getWorkoutById.get(workoutId);
    if (!workout) {
      throw new Error('Workout not found');
    }

    const groupItems = this.stmt.listGroupExercises.all(workout.group_id);
    const sets = this.stmt.getWorkoutSets.all(workoutId);

    return {
      workout,
      groupItems,
      sets
    };
  }

  logWorkoutSet(payload) {
    const workoutId = positiveInt(payload?.workoutId, 'Workout ID');
    const groupExerciseId = positiveInt(payload?.groupExerciseId, 'Group exercise ID');
    const reps = positiveInt(payload?.reps, 'Reps');
    const weight = nonNegativeNumber(payload?.weight ?? 0, 'Weight');
    const rpe = payload?.rpe === undefined || payload?.rpe === null || payload?.rpe === ''
      ? null
      : nonNegativeNumber(payload.rpe, 'RPE');
    const notes = optionalText(payload?.notes);

    const workoutGuard = this.stmt.getWorkoutForSetLogging.get(groupExerciseId, workoutId);
    if (!workoutGuard) {
      throw new Error('Workout or group exercise not found');
    }
    if (workoutGuard.status !== 'active') {
      throw new Error('Workout is already finished');
    }
    if (workoutGuard.group_id !== workoutGuard.group_exercise_group_id) {
      throw new Error('Group exercise does not belong to this workout');
    }

    const setNumber = this.stmt.nextSetNumber.get(workoutId, groupExerciseId).next_set;

    const result = this.stmt.createWorkoutSet.run(
      workoutId,
      groupExerciseId,
      setNumber,
      reps,
      weight,
      rpe,
      notes
    );

    const setId = result.lastInsertRowid;
    this.updateRecordsForSet({ workoutId, groupExerciseId, setId, reps, weight });

    return { id: setId, set_number: setNumber };
  }

  updateRecordsForSet({ workoutId, groupExerciseId, setId, reps, weight }) {
    const ge = this.stmt.getGroupExerciseById.get(groupExerciseId);
    if (!ge) {
      return;
    }

    const workout = this.stmt.getWorkoutDate.get(workoutId);
    const achievedOn = workout?.performed_on || new Date().toISOString().slice(0, 10);

    const exerciseId = ge.exercise_id;
    const variationId = ge.variation_id || null;
    const variationKey = variationId || 0;

    this.stmt.upsertRecord.run(
      exerciseId,
      variationId,
      variationKey,
      'max_reps',
      reps,
      achievedOn,
      setId
    );

    if (weight > 0) {
      const volume = weight * reps;
      const est1rm = weight * (1 + reps / 30);

      this.stmt.upsertRecord.run(
        exerciseId,
        variationId,
        variationKey,
        'max_weight',
        weight,
        achievedOn,
        setId
      );

      this.stmt.upsertRecord.run(
        exerciseId,
        variationId,
        variationKey,
        'max_volume',
        volume,
        achievedOn,
        setId
      );

      this.stmt.upsertRecord.run(
        exerciseId,
        variationId,
        variationKey,
        'est_1rm',
        est1rm,
        achievedOn,
        setId
      );
    }
  }

  getPersonalRecords(payload) {
    if (payload?.exerciseId) {
      const exerciseId = positiveInt(payload.exerciseId, 'Exercise ID');
      return this.stmt.getPersonalRecordsByExercise.all(exerciseId);
    }
    return this.stmt.getPersonalRecords.all();
  }

  getRecentSets(payload) {
    const limit = payload?.limit ? positiveInt(payload.limit, 'Limit') : 40;

    if (payload?.exerciseId) {
      const exerciseId = positiveInt(payload.exerciseId, 'Exercise ID');
      return this.stmt.getRecentSetsByExercise.all(exerciseId, limit);
    }

    return this.stmt.getRecentSets.all(limit);
  }

  getDailyLogDay(payload) {
    const performedOn = requiredText(payload?.performedOn, 'Date');
    const rows = this.stmt.listDailyLogsByDate.all(performedOn);

    const entries = rows.map((row) => ({
      id: row.id,
      exercise_id: row.exercise_id,
      exercise_name: row.exercise_name,
      muscle_groups: parseJsonArray(row.muscle_groups),
      suboptions: parseJsonArray(row.suboptions),
      selected_tags: parseJsonArray(row.selected_tags),
      order_index: row.order_index,
      sets: this.stmt.listDailyLogSetsByLogId.all(row.id).map((set) => ({
        set_number: set.set_number,
        reps: set.reps,
        weight: set.weight
      }))
    }));

    return {
      performed_on: performedOn,
      entries
    };
  }

  replaceDailyLogDay(payload) {
    const performedOn = requiredText(payload?.performedOn, 'Date');
    const rawEntries = Array.isArray(payload?.entries) ? payload.entries : [];

    const dedupedEntries = [];
    const seenExerciseIds = new Set();

    for (const rawEntry of rawEntries) {
      const exerciseId = positiveInt(rawEntry?.exerciseId, 'Exercise ID');
      if (seenExerciseIds.has(exerciseId)) {
        continue;
      }
      seenExerciseIds.add(exerciseId);

      const rawSets = Array.isArray(rawEntry?.sets) ? rawEntry.sets : [];
      const sets = rawSets.length
        ? rawSets.map((set, index) => ({
          set_number: index + 1,
          reps: optionalPositiveInt(set?.reps),
          weight: optionalNonNegativeNumber(set?.weight)
        }))
        : [{ set_number: 1, reps: null, weight: null }];

      const selectedTags = textArray(rawEntry?.selectedTags, 'Selected tags');
      dedupedEntries.push({ exerciseId, sets, selectedTags });
    }

    const tx = this.db.transaction((entries) => {
      this.stmt.deleteDailyLogsByDate.run(performedOn);

      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const inserted = this.stmt.insertDailyLog.run(
          performedOn,
          entry.exerciseId,
          JSON.stringify(entry.selectedTags),
          index + 1
        );
        const dailyLogId = inserted.lastInsertRowid;

        for (const set of entry.sets) {
          this.stmt.insertDailyLogSet.run(dailyLogId, set.set_number, set.reps, set.weight);
        }
      }
    });

    tx(dedupedEntries);
    return this.getDailyLogDay({ performedOn });
  }

  getCaloriesTargets() {
    const existing = this.stmt.getCaloriesTargets.get();
    if (existing) {
      return existing;
    }

    this.stmt.upsertCaloriesTargets.run(2200, 150);
    return this.stmt.getCaloriesTargets.get();
  }

  setCaloriesTargets(payload) {
    const targetKcal = nonNegativeNumber(payload?.targetKcal, 'Target kcal');
    const targetProtein = nonNegativeNumber(payload?.targetProtein, 'Target protein');

    if (targetKcal <= 0 || targetProtein <= 0) {
      throw new Error('Target kcal and target protein must be greater than zero');
    }

    this.stmt.upsertCaloriesTargets.run(targetKcal, targetProtein);
    return this.getCaloriesTargets();
  }

  listCaloriesFoodLogs(payload) {
    const consumedOn = requiredText(payload?.consumedOn, 'Date');
    return this.stmt.listCaloriesFoodLogsByDate.all(consumedOn);
  }

  getCaloriesSummary(payload) {
    const consumedOn = requiredText(payload?.consumedOn, 'Date');
    const totals = this.stmt.getCaloriesFoodTotalsByDate.get(consumedOn) || { kcal_sum: 0, protein_sum: 0 };
    return {
      consumed_on: consumedOn,
      kcal: Number(totals.kcal_sum) || 0,
      protein: Number(totals.protein_sum) || 0
    };
  }

  getCaloriesMonthSummary(payload) {
    const month = requiredText(payload?.month, 'Month');
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new Error('Month must have format YYYY-MM');
    }

    const [yearRaw, monthRaw] = month.split('-');
    const year = Number.parseInt(yearRaw, 10);
    const monthIndex = Number.parseInt(monthRaw, 10);
    if (!Number.isInteger(year) || !Number.isInteger(monthIndex) || monthIndex < 1 || monthIndex > 12) {
      throw new Error('Invalid month value');
    }

    const startDate = `${year}-${String(monthIndex).padStart(2, '0')}-01`;
    const endDay = new Date(year, monthIndex, 0).getDate();
    const endDate = `${year}-${String(monthIndex).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    const rows = this.stmt.getCaloriesFoodTotalsByRange.all(startDate, endDate);
    return {
      month,
      start_date: startDate,
      end_date: endDate,
      points: rows.map((row) => ({
        date: row.consumed_on,
        kcal: Number(row.kcal_sum) || 0,
        protein: Number(row.protein_sum) || 0
      }))
    };
  }

  addCaloriesFoodLog(payload) {
    const consumedOn = requiredText(payload?.consumedOn, 'Date');
    const foodId = requiredText(payload?.foodId, 'Food ID');
    const title = requiredText(payload?.title, 'Food title');
    const grams = nonNegativeNumber(payload?.grams, 'Grams');
    const kcal = nonNegativeNumber(payload?.kcal, 'Calories');
    const protein = nonNegativeNumber(payload?.protein, 'Protein');
    const imageUrl = optionalText(payload?.imageUrl);

    if (grams <= 0) {
      throw new Error('Grams must be greater than zero');
    }

    const result = this.stmt.insertCaloriesFoodLog.run(
      consumedOn,
      foodId,
      title,
      grams,
      kcal,
      protein,
      imageUrl
    );

    return {
      id: result.lastInsertRowid,
      consumed_on: consumedOn,
      food_id: foodId,
      title,
      grams,
      kcal,
      protein,
      image_url: imageUrl
    };
  }

  deleteCaloriesFoodLog(payload) {
    const consumedOn = requiredText(payload?.consumedOn, 'Date');
    const logId = positiveInt(payload?.logId, 'Food log ID');
    const result = this.stmt.deleteCaloriesFoodLogById.run(logId, consumedOn);
    if (result.changes === 0) {
      throw new Error('Food log entry not found');
    }
    return {
      ok: true,
      summary: this.getCaloriesSummary({ consumedOn })
    };
  }

  getRepsAnalytics(payload) {
    const exerciseId = positiveInt(payload?.exerciseId, 'Exercise ID');
    const startDate = requiredText(payload?.startDate, 'Start date');
    const endDate = requiredText(payload?.endDate, 'End date');
    const tag = optionalText(payload?.tag);
    const tagKey = tag ? tag.toLowerCase() : '';

    const rows = this.stmt.listAnalyticsRowsByExerciseRange.all(exerciseId, startDate, endDate);
    const byLogId = new Map();

    for (const row of rows) {
      let current = byLogId.get(row.daily_log_id);
      if (!current) {
        current = {
          date: row.performed_on,
          selectedTags: parseJsonArray(row.selected_tags),
          repsValues: [],
          weightValues: [],
          volumeValues: []
        };
        byLogId.set(row.daily_log_id, current);
      }

      const reps = Number.isInteger(row.reps) && row.reps > 0 ? row.reps : null;
      const weight = typeof row.weight === 'number' && Number.isFinite(row.weight) && row.weight >= 0
        ? row.weight
        : null;

      if (reps !== null) {
        current.repsValues.push(reps);
      }
      if (weight !== null) {
        current.weightValues.push(weight);
      }
      if (reps !== null && weight !== null) {
        current.volumeValues.push(reps * weight);
      }
    }

    const filteredLogs = Array.from(byLogId.values())
      .filter((item) => {
        if (!tagKey) {
          return true;
        }
        return item.selectedTags.some((value) => String(value || '').toLowerCase() === tagKey);
      })
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

    const points = filteredLogs.map((item) => {
      const repsAvg = average(item.repsValues);
      const repsMax = item.repsValues.length ? Math.max(...item.repsValues) : 0;

      const weightAvg = average(item.weightValues);
      const weightMax = item.weightValues.length ? Math.max(...item.weightValues) : 0;

      const volumeAvg = average(item.volumeValues);
      const volumeMax = item.volumeValues.length ? Math.max(...item.volumeValues) : 0;

      return {
        date: item.date,
        reps_avg: repsAvg,
        reps_max: repsMax,
        weight_avg: weightAvg,
        weight_max: weightMax,
        volume_avg: volumeAvg,
        volume_max: volumeMax,
        sets_count: item.repsValues.length
      };
    });

    return {
      exercise_id: exerciseId,
      start_date: startDate,
      end_date: endDate,
      points
    };
  }

  getDashboard() {
    const counts = this.stmt.dashboard.get();
    const activeWorkouts = this.listActiveWorkouts();
    const latestWorkouts = this.listWorkouts({ limit: 5 });

    return {
      ...counts,
      activeWorkouts,
      latestWorkouts
    };
  }
}

module.exports = LoglyDatabase;
