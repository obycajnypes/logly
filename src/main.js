const fs = require('fs');
const path = require('path');
const https = require('https');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');

let db;
let LoglyDatabase;

const KT_AUTOCOMPLETE_URL = 'https://www.kaloricketabulky.sk/autocomplete/foodstuff-activity-meal';
const KT_DETAIL_BASE_URL = 'https://www.kaloricketabulky.sk/foodstuff/detail';
const KT_DETAIL_FORM_BASE_URL = 'https://www.kaloricketabulky.sk/foodstuff/detail/form';
const KT_THUMB_BASE_URL = 'https://www.kaloricketabulky.sk/file/image/thumb/foodstuff';

function requiredText(value, fieldName) {
  const parsed = typeof value === 'string' ? value.trim() : '';
  if (!parsed) {
    throw new Error(`${fieldName} is required`);
  }
  return parsed;
}

function positiveNumber(value, fieldName) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${fieldName} must be greater than zero`);
  }
  return parsed;
}

function parseLocaleNumber(value) {
  if (value === null || value === undefined) {
    return 0;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }
  const normalized = String(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function requestJson(url, redirectDepth = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Logly/1.0 (+https://logly.local)',
        Referer: 'https://www.kaloricketabulky.sk/'
      }
    }, (res) => {
      const status = Number(res.statusCode) || 0;

      if (status >= 300 && status < 400 && res.headers.location && redirectDepth < 3) {
        const nextUrl = new URL(res.headers.location, url).toString();
        res.resume();
        requestJson(nextUrl, redirectDepth + 1).then(resolve).catch(reject);
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`Calories API request failed (${status})`));
        return;
      }

      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        raw += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (error) {
          reject(new Error(`Calories API returned invalid JSON: ${error.message}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Calories API request error: ${error.message}`));
    });

    req.setTimeout(9000, () => {
      req.destroy(new Error('Calories API request timed out'));
    });
  });
}

async function searchFoods(payload) {
  const query = requiredText(payload?.query, 'Search query');
  const url = `${KT_AUTOCOMPLETE_URL}?query=${encodeURIComponent(query)}&format=json`;
  const response = await requestJson(url);
  if (!Array.isArray(response)) {
    return [];
  }

  return response
    .filter((item) => item && item.clazz === 'foodstuff' && item.id && item.title)
    .slice(0, 5)
    .map((item) => ({
      id: String(item.id),
      title: String(item.title),
      imageUrl: `${KT_THUMB_BASE_URL}/${encodeURIComponent(String(item.id))}`
    }));
}

async function fetchFoodNutrition(payload) {
  const foodId = requiredText(payload?.foodId, 'Food ID');
  const grams = positiveNumber(payload?.grams, 'Grams');
  const url = `${KT_DETAIL_BASE_URL}/${encodeURIComponent(foodId)}/${encodeURIComponent(String(grams))}/0000000000000001?format=json`;
  const response = await requestJson(url);
  const food = response?.foodstuff;

  if (!food || typeof food !== 'object') {
    throw new Error('Food detail is unavailable for this item');
  }

  const kcal = parseLocaleNumber(food.energy);
  const protein = parseLocaleNumber(food.protein);
  const title = typeof food.title === 'string' && food.title.trim()
    ? food.title.trim()
    : (typeof payload?.title === 'string' ? payload.title.trim() : '');

  if (!title) {
    throw new Error('Food detail did not provide a valid title');
  }

  return {
    foodId,
    title,
    grams,
    kcal,
    protein,
    imageUrl: `${KT_THUMB_BASE_URL}/${encodeURIComponent(foodId)}`
  };
}

async function fetchFoodUnitOptions(payload) {
  const foodId = requiredText(payload?.foodId, 'Food ID');
  const url = `${KT_DETAIL_FORM_BASE_URL}/${encodeURIComponent(foodId)}?format=json&default=true`;
  const response = await requestJson(url);
  const options = Array.isArray(response?.unitOptions) ? response.unitOptions : [];
  const seen = new Set();

  return options
    .map((item) => (typeof item?.title === 'string' ? item.title.trim() : ''))
    .filter((title) => {
      if (!title) {
        return false;
      }
      const key = title.toLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function setupDevRendererHotReload(window) {
  if (process.env.LOGLY_DEV_HOT !== '1') {
    return;
  }

  const rendererDir = path.join(__dirname, 'renderer');
  let debounceTimer = null;
  let watcher;

  const triggerReload = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!window.isDestroyed() && window.isFocused()) {
        window.webContents.reloadIgnoringCache();
      }
    }, 110);
  };

  try {
    watcher = fs.watch(rendererDir, { recursive: true }, (_eventType, fileName) => {
      if (!fileName || !/\.(js|html|css)$/.test(fileName)) {
        return;
      }
      triggerReload();
    });
    console.log('[dev] Renderer hot reload enabled');
  } catch (error) {
    console.warn('[dev] Hot reload watcher could not start:', error.message);
    return;
  }

  const closeWatcher = () => {
    clearTimeout(debounceTimer);
    if (watcher) {
      watcher.close();
      watcher = null;
    }
  };

  window.on('closed', closeWatcher);
  app.on('before-quit', closeWatcher);
}

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1040,
    minHeight: 700,
    autoHideMenuBar: process.platform === 'win32',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.platform === 'win32') {
    window.removeMenu();
    window.setMenuBarVisibility(false);
  }

  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  window.maximize();
  setupDevRendererHotReload(window);
  return window;
}

function registerHandlers() {
  const handle = (channel, handler) => {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        const data = await handler(payload);
        return { ok: true, data };
      } catch (error) {
        return { ok: false, error: error.message || 'Unexpected error' };
      }
    });
  };

  handle('dashboard:get', () => db.getDashboard());

  handle('categories:list', () => db.listCategories());
  handle('categories:create', (payload) => db.createCategory(payload));

  handle('exercises:list', () => db.listExercises());
  handle('exercises:create', (payload) => db.createExercise(payload));
  handle('exercises:update', (payload) => db.updateExercise(payload));
  handle('exercises:delete', (payload) => db.deleteExercise(payload));
  handle('exercise-tags:create', (payload) => db.createExerciseTag(payload));
  handle('exercise-tags:list', () => db.listExerciseTags());
  handle('exercise-tags:delete', (payload) => db.deleteExerciseTag(payload));
  handle('exercises:assign-category', (payload) => db.assignCategoryToExercise(payload));

  handle('variations:create', (payload) => db.createVariation(payload));

  handle('groups:list', () => db.listGroups());
  handle('groups:create', (payload) => db.createGroup(payload));
  handle('groups:delete', (payload) => db.deleteGroup(payload));
  handle('groups:clear-all', () => db.clearAllTemplatesData());
  handle('groups:get', (payload) => db.getGroupDetails(payload));
  handle('groups:add-item', (payload) => db.addGroupExercise(payload));
  handle('groups:remove-item', (payload) => db.removeGroupExercise(payload));

  handle('workouts:start', (payload) => db.startWorkout(payload));
  handle('workouts:list', (payload) => db.listWorkouts(payload));
  handle('workouts:active', () => db.listActiveWorkouts());
  handle('workouts:get', (payload) => db.getWorkoutDetails(payload));
  handle('workouts:finish', (payload) => db.finishWorkout(payload));
  handle('workouts:log-set', (payload) => db.logWorkoutSet(payload));
  handle('log-day:get', (payload) => db.getDailyLogDay(payload));
  handle('log-day:replace', (payload) => db.replaceDailyLogDay(payload));
  handle('calories:targets:get', () => db.getCaloriesTargets());
  handle('calories:targets:set', (payload) => db.setCaloriesTargets(payload));
  handle('calories:food:search', (payload) => searchFoods(payload));
  handle('calories:food:units', (payload) => fetchFoodUnitOptions(payload));
  handle('calories:food:list', (payload) => db.listCaloriesFoodLogs(payload));
  handle('calories:summary:get', (payload) => db.getCaloriesSummary(payload));
  handle('calories:summary:month', (payload) => db.getCaloriesMonthSummary(payload));
  handle('calories:food:delete', (payload) => db.deleteCaloriesFoodLog(payload));
  handle('calories:food:add', async (payload) => {
    const consumedOn = requiredText(payload?.consumedOn, 'Date');
    const nutrition = await fetchFoodNutrition(payload);
    const entry = db.addCaloriesFoodLog({
      consumedOn,
      foodId: nutrition.foodId,
      title: nutrition.title,
      grams: nutrition.grams,
      kcal: nutrition.kcal,
      protein: nutrition.protein,
      imageUrl: nutrition.imageUrl
    });
    return {
      entry,
      summary: db.getCaloriesSummary({ consumedOn })
    };
  });
  handle('analytics:reps', (payload) => db.getRepsAnalytics(payload));

  handle('progress:records', (payload) => db.getPersonalRecords(payload));
  handle('progress:recent-sets', (payload) => db.getRecentSets(payload));
}

app.whenReady()
  .then(() => {
    try {
      LoglyDatabase = require('./db');
      db = new LoglyDatabase(path.join(app.getPath('userData'), 'logly.db'));
    } catch (error) {
      const message = [
        'Failed to initialize database.',
        '',
        error?.message || 'Unknown startup error',
        '',
        'Run: npm run rebuild:native'
      ].join('\n');
      console.error(message);
      dialog.showErrorBox('Logly Startup Error', message);
      app.quit();
      return;
    }

    registerHandlers();
    createMainWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  })
  .catch((error) => {
    console.error('Unhandled app startup error:', error);
    app.quit();
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
