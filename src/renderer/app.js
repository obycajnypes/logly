const state = {
  categories: [],
  exercises: [],
  groups: [],
  templateDetails: [],
  selectedGroupId: null,
  templatePickerGroupId: null,
  templatePickerSearch: '',
  templatePickerMuscleFilter: '',
  templatePickerSelectedExerciseIds: [],
  customExerciseSuboptions: [],
  globalExerciseTags: [],
  exerciseMuscleFilter: '',
  exerciseMuscleOptions: [],
  analyticsExerciseId: null,
  analyticsTagFilter: '',
  analyticsPeriod: 'month',
  analyticsMetric: 'avg',
  analyticsValueType: 'reps',
  logDate: '',
  logEntries: [],
  logPickerSearch: '',
  logPickerMuscleFilter: '',
  logPickerSelectedExerciseIds: [],
  logTemplateSelectionId: null,
  editingExerciseId: null,
  openExerciseMenuId: null,
  caloriesTargets: {
    targetKcal: 2200,
    targetProtein: 150
  },
  caloriesMenuOpen: false,
  caloriesConsumed: {
    kcal: 0,
    protein: 0
  },
  caloriesFoodEntries: [],
  caloriesSearchQuery: '',
  caloriesSearchResults: [],
  caloriesSelectedFood: null,
  caloriesSearchRequestId: 0,
  caloriesSelectedFoodUnits: [],
  caloriesSelectedFoodUnitsLoading: false,
  caloriesSelectedFoodUnitsRequestId: 0,
  caloriesChartMonth: '',
  caloriesMonthlyPoints: []
};

let logPersistDebounceId = null;
let logDayHydrated = false;
let caloriesSearchDebounceId = null;

const TEMPLATE_RESET_KEY = 'logly.templates.v2.reset.done';

function el(selector) {
  return document.querySelector(selector);
}

function escapeHtml(text) {
  if (text === null || text === undefined) {
    return '';
  }
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function setStatus(message, type = '') {
  const node = el('#status');
  if (!node) {
    return;
  }
  node.textContent = message;
  node.className = `status ${type}`.trim();
}

function exerciseColorForMuscleGroup(muscleGroup) {
  const group = normalizeText(muscleGroup);
  const colorMap = {
    chest: '#f39c12',
    back: '#4da3ff',
    shoulders: '#f06292',
    biceps: '#9b59b6',
    triceps: '#16a085',
    quads: '#ff6b6b',
    hamstrings: '#8e44ad',
    glutes: '#e67e22',
    core: '#26a69a',
    calves: '#5c6bc0'
  };
  return colorMap[group] || '#c8f452';
}

async function invoke(channel, payload) {
  const result = await window.logly.invoke(channel, payload);
  if (!result?.ok) {
    throw new Error(result?.error || 'Unknown error');
  }
  return result.data;
}

function isoTodayLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isoCurrentMonthLocal() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function monthRangeFromValue(monthValue) {
  const value = String(monthValue || '').trim();
  if (!/^\d{4}-\d{2}$/.test(value)) {
    const fallback = isoCurrentMonthLocal();
    return monthRangeFromValue(fallback);
  }

  const [yearRaw, monthRaw] = value.split('-');
  const year = Number.parseInt(yearRaw, 10);
  const monthIndex = Number.parseInt(monthRaw, 10);
  const endDay = new Date(year, monthIndex, 0).getDate();
  return {
    month: value,
    year,
    monthIndex,
    endDay,
    startDate: `${yearRaw}-${monthRaw}-01`,
    endDate: `${yearRaw}-${monthRaw}-${String(endDay).padStart(2, '0')}`
  };
}

function formatLogDate(isoDate) {
  if (!isoDate) {
    return '';
  }
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });
}

function toIsoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getAnalyticsRange(period) {
  const now = new Date();
  const endDate = toIsoDate(now);
  let startDate;

  if (period === 'year') {
    startDate = `${now.getFullYear()}-01-01`;
  } else {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    startDate = toIsoDate(monthStart);
  }

  const label = `${formatLogDate(startDate)} - ${formatLogDate(endDate)}`;
  return { startDate, endDate, label };
}

function formatChartDate(isoDate) {
  const parsed = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatMetricNumber(value, maxFractionDigits = 1) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '0';
  }
  return numeric.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits
  });
}

function exerciseDisplayTags(exercise, limit = 3) {
  const muscleGroups = Array.isArray(exercise?.muscle_groups) ? exercise.muscle_groups : [];
  const secondaryMuscles = muscleGroups.slice(1);
  const suboptions = Array.isArray(exercise?.suboptions) ? exercise.suboptions : [];
  return secondaryMuscles.concat(suboptions).slice(0, limit);
}

function normalizeUniqueTags(tags) {
  const seen = new Set();
  const normalized = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = String(tag || '').trim();
    if (!value) {
      continue;
    }
    const key = normalizeText(value);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

function buildLogEntryFromExercise(exercise, existingEntry = null) {
  const primaryMuscle = primaryMuscleForExercise(exercise);
  const availableTags = normalizeUniqueTags(exercise?.suboptions || []);
  const requestedSelected = normalizeUniqueTags(existingEntry?.selectedTags || []);
  const selectedTags = requestedSelected.length
    ? availableTags.filter((tag) => requestedSelected.some((item) => normalizeText(item) === normalizeText(tag)))
    : availableTags.slice();
  const existingSets = Array.isArray(existingEntry?.sets) ? existingEntry.sets : [];
  const sets = existingSets.length
    ? existingSets.map((set) => ({
      weight: set?.weight ?? '',
      reps: set?.reps ?? ''
    }))
    : [{ weight: '', reps: '' }];

  return {
    exerciseId: exercise.id,
    name: exercise.name,
    primaryMuscle,
    markerColor: exerciseColorForMuscleGroup(primaryMuscle),
    availableTags,
    selectedTags,
    sets
  };
}

function nonEmptyTemplateDetails() {
  return state.templateDetails
    .filter((row) => Array.isArray(row?.items) && row.items.length > 0)
    .slice()
    .sort((a, b) => String(a?.group?.name || '').localeCompare(String(b?.group?.name || '')));
}

function syncLogEntriesWithExercises() {
  if (!state.logEntries.length) {
    return;
  }

  const byId = new Map(state.exercises.map((exercise) => [exercise.id, exercise]));
  state.logEntries = state.logEntries
    .map((entry) => {
      const exercise = byId.get(entry.exerciseId);
      if (!exercise) {
        return null;
      }
      return buildLogEntryFromExercise(exercise, entry);
    })
    .filter(Boolean);
}

function activateTab(tabName) {
  const buttons = document.querySelectorAll('.tab-btn');
  const panels = document.querySelectorAll('.tab-panel');
  buttons.forEach((b) => b.classList.remove('active'));
  panels.forEach((p) => p.classList.remove('active'));

  const button = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  const panel = el(`#tab-${tabName}`);
  if (button && panel) {
    button.classList.add('active');
    panel.classList.add('active');
  }
}

function setupTabs() {
  const buttons = document.querySelectorAll('.tab-btn');

  buttons.forEach((button) => {
    button.addEventListener('click', () => activateTab(button.dataset.tab));
  });

  const quickStart = el('#quick-start-workout');
  if (quickStart) {
    quickStart.addEventListener('click', () => {
      activateTab('templates');
      el('#template-create-toggle')?.focus();
    });
  }
}

function updateTemplateEditorTitle() {
  // Kept for compatibility with older renderer layout.
}

async function selectTemplate(groupId, options = {}) {
  state.selectedGroupId = groupId || null;
  updateTemplateEditorTitle();
  if (options?.focusExercise) {
    el('#template-create-toggle')?.focus();
  }
}

function primaryMuscleForExercise(exercise) {
  if (!exercise || !Array.isArray(exercise.muscle_groups) || !exercise.muscle_groups.length) {
    return 'General';
  }
  return exercise.muscle_groups[0];
}

function setTemplateExerciseModalVisibility(visible) {
  const modal = el('#template-exercise-modal');
  if (!modal) {
    return;
  }

  if (visible) {
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}

function resetTemplatePickerState() {
  state.templatePickerGroupId = null;
  state.templatePickerSearch = '';
  state.templatePickerMuscleFilter = '';
  state.templatePickerSelectedExerciseIds = [];
}

function renderTemplatePickerMuscleChips() {
  const chips = el('#template-exercise-muscle-chips');
  if (!chips) {
    return;
  }

  const options = new Set();
  for (const exercise of state.exercises) {
    const primary = primaryMuscleForExercise(exercise);
    if (primary) {
      options.add(primary);
    }
  }

  const sorted = Array.from(options).sort((a, b) => a.localeCompare(b));
  const selected = state.templatePickerMuscleFilter || '';
  const all = [''].concat(sorted);

  chips.innerHTML = all
    .map((value) => {
      const isActive = value === selected;
      const label = value || 'All';
      return `<button type="button" class="exercise-chip ${isActive ? 'active' : ''}" data-template-muscle-chip="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    })
    .join('');
}

function renderTemplateExerciseList() {
  const list = el('#template-exercise-list');
  if (!list) {
    return;
  }

  const search = normalizeText(state.templatePickerSearch);
  const muscleFilter = normalizeText(state.templatePickerMuscleFilter);

  const filtered = state.exercises.filter((exercise) => {
    const primaryMuscle = primaryMuscleForExercise(exercise);
    const muscleMatch = !muscleFilter || normalizeText(primaryMuscle) === muscleFilter;
    const textMatch = !search
      || normalizeText(exercise.name).includes(search)
      || (Array.isArray(exercise.muscle_groups)
        ? exercise.muscle_groups.some((group) => normalizeText(group).includes(search))
        : false);
    return muscleMatch && textMatch;
  });

  if (!filtered.length) {
    list.innerHTML = '<p class="empty">No matching exercises.</p>';
    return;
  }

  list.innerHTML = filtered
    .map((exercise) => {
      const primary = primaryMuscleForExercise(exercise);
      const tags = (Array.isArray(exercise.suboptions) ? exercise.suboptions : []).slice(0, 2);
      const selected = state.templatePickerSelectedExerciseIds.includes(exercise.id);
      const markerColor = exerciseColorForMuscleGroup(primary);
      const tagHtml = tags.length
        ? tags.map((tag) => `<span class="template-picker-tag">${escapeHtml(tag)}</span>`).join('')
        : '';

      return `
        <button type="button" class="template-picker-card ${selected ? 'active' : ''}" data-template-picker-exercise-id="${exercise.id}">
          <div class="template-picker-top">
            <span class="template-picker-icon">
              <span class="exercise-card-triangle" style="--triangle-color: ${markerColor}"></span>
            </span>
            <span class="exercise-pill template-picker-pill">${escapeHtml(primary)}</span>
          </div>
          <div class="template-picker-name">${escapeHtml(exercise.name)}</div>
          <div class="template-picker-meta">Primary: ${escapeHtml(primary)}</div>
          <div class="template-clean-tags">${tagHtml}</div>
        </button>
      `;
    })
    .join('');
}

function openTemplateExerciseModal(groupId) {
  const group = state.groups.find((item) => item.id === groupId);
  if (!group) {
    return;
  }

  const detail = state.templateDetails.find((row) => row?.group?.id === groupId);
  const existingExerciseIds = detail
    ? Array.from(new Set(detail.items.map((item) => item.exercise_id)))
    : [];

  state.templatePickerGroupId = groupId;
  state.templatePickerSearch = '';
  state.templatePickerMuscleFilter = '';
  state.templatePickerSelectedExerciseIds = existingExerciseIds;

  const title = el('#template-exercise-modal-title');
  if (title) {
    title.textContent = `Add Exercises · ${group.name}`;
  }

  const searchInput = el('#template-exercise-search');
  if (searchInput) {
    searchInput.value = '';
  }

  renderTemplatePickerMuscleChips();
  renderTemplateExerciseList();
  setTemplateExerciseModalVisibility(true);
  searchInput?.focus();
}

function closeTemplateExerciseModal() {
  resetTemplatePickerState();
  setTemplateExerciseModalVisibility(false);
}

async function saveTemplateExerciseSelection() {
  const groupId = state.templatePickerGroupId;
  if (!groupId) {
    return;
  }

  const selectedIds = Array.from(new Set(state.templatePickerSelectedExerciseIds.slice()));

  const payload = await invoke('groups:get', { groupId });
  const existingExerciseIds = new Set(payload.items.map((item) => item.exercise_id));
  const selectedIdSet = new Set(selectedIds);
  const toAdd = selectedIds.filter((id) => !existingExerciseIds.has(id));
  const toRemove = payload.items.filter((item) => !selectedIdSet.has(item.exercise_id));

  for (const exerciseId of toAdd) {
    await invoke('groups:add-item', {
      groupId,
      exerciseId,
      variationId: null,
      targetSets: 3,
      targetReps: '8-12'
    });
  }

  for (const row of toRemove) {
    await invoke('groups:remove-item', { groupExerciseId: row.id });
  }

  closeTemplateExerciseModal();
  await refreshTemplatesBoard();

  const addedCount = toAdd.length;
  const removedCount = toRemove.length;
  if (addedCount === 0 && removedCount === 0) {
    setStatus('Selection unchanged.', 'ok');
    return;
  }

  const addedLabel = `${addedCount} added`;
  const removedLabel = `${removedCount} removed`;
  setStatus(`Selection saved (${addedLabel}, ${removedLabel}).`, 'ok');
}

async function maybeResetLegacyTemplates() {
  if (window.localStorage.getItem(TEMPLATE_RESET_KEY) === '1') {
    return;
  }

  try {
    await invoke('groups:clear-all');
    window.localStorage.setItem(TEMPLATE_RESET_KEY, '1');
  } catch (error) {
    console.warn('Template reset skipped:', error.message);
  }
}

function readCheckedValues(selector) {
  return Array.from(document.querySelectorAll(selector)).map((node) => node.value);
}

function hasSelectedSuboption(value) {
  const key = normalizeText(value);
  return state.customExerciseSuboptions.some((item) => normalizeText(item) === key);
}

function renderAvailableExerciseSuboptions() {
  const container = el('#available-suboptions-list');
  if (!container) {
    return;
  }

  if (!state.globalExerciseTags.length) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = state.globalExerciseTags
    .map((tag) => {
      const active = hasSelectedSuboption(tag);
      return `
        <button type="button" class="tag suggested-tag-btn ${active ? 'active' : ''}" data-global-suboption="${escapeHtml(tag)}">
          <span class="suggested-tag-text">${escapeHtml(tag)}</span>
          <span class="suggested-tag-remove" data-remove-global-suboption="${escapeHtml(tag)}" aria-label="Delete tag">×</span>
        </button>
      `;
    })
    .join('');
}

function resetExerciseDrawerForm() {
  const form = el('#exercise-drawer-form');
  if (!form) {
    return;
  }
  form.reset();
  state.customExerciseSuboptions = [];
  state.editingExerciseId = null;
  const title = el('#exercise-drawer-title');
  const submit = el('#exercise-drawer-submit');
  if (title) {
    title.textContent = 'New Exercise';
  }
  if (submit) {
    submit.textContent = 'Create Exercise';
  }
  renderAvailableExerciseSuboptions();
}

function setExerciseDrawerVisibility(visible) {
  const drawer = el('#exercise-drawer');
  const backdrop = el('#exercise-drawer-backdrop');
  if (visible) {
    drawer?.classList.remove('hidden');
    backdrop?.classList.remove('hidden');
  } else {
    drawer?.classList.add('hidden');
    backdrop?.classList.add('hidden');
  }
}

function openExerciseDrawerForCreate() {
  state.openExerciseMenuId = null;
  resetExerciseDrawerForm();
  setExerciseDrawerVisibility(true);
  el('#exercise-name-input')?.focus();
}

function openExerciseDrawerForEdit(exercise) {
  if (!exercise) {
    return;
  }

  state.openExerciseMenuId = null;
  resetExerciseDrawerForm();
  state.editingExerciseId = exercise.id;

  const title = el('#exercise-drawer-title');
  const submit = el('#exercise-drawer-submit');
  if (title) {
    title.textContent = 'Edit Exercise';
  }
  if (submit) {
    submit.textContent = 'Save Changes';
  }

  const nameInput = el('#exercise-name-input');
  if (nameInput) {
    nameInput.value = exercise.name || '';
  }

  const selectedMuscles = new Set(Array.isArray(exercise.muscle_groups) ? exercise.muscle_groups.map((v) => normalizeText(v)) : []);
  document.querySelectorAll('#exercise-drawer-form input[name="muscleGroup"]').forEach((node) => {
    node.checked = selectedMuscles.has(normalizeText(node.value));
  });

  state.customExerciseSuboptions = Array.isArray(exercise.suboptions) ? exercise.suboptions.slice() : [];
  renderAvailableExerciseSuboptions();

  setExerciseDrawerVisibility(true);
  el('#exercise-name-input')?.focus();
}

function clearLogPersistDebounce() {
  if (logPersistDebounceId) {
    clearTimeout(logPersistDebounceId);
    logPersistDebounceId = null;
  }
}

async function persistLogDay() {
  if (!logDayHydrated) {
    return;
  }
  clearLogPersistDebounce();
  const entries = state.logEntries.map((entry) => ({
    exerciseId: entry.exerciseId,
    selectedTags: normalizeUniqueTags(entry.selectedTags),
    sets: (Array.isArray(entry.sets) && entry.sets.length ? entry.sets : [{ weight: '', reps: '' }]).map((set) => ({
      weight: set?.weight ?? '',
      reps: set?.reps ?? ''
    }))
  }));

  await invoke('log-day:replace', {
    performedOn: state.logDate,
    entries
  });
}

function schedulePersistLogDay() {
  clearLogPersistDebounce();
  logPersistDebounceId = setTimeout(() => {
    persistLogDay().catch((error) => setStatus(error.message, 'error'));
  }, 260);
}

async function loadLogDayFromDb(performedOn) {
  clearLogPersistDebounce();
  logDayHydrated = false;
  const payload = await invoke('log-day:get', { performedOn });
  const nextEntries = [];

  for (const row of payload.entries || []) {
    const exercise = state.exercises.find((item) => item.id === row.exercise_id);
    if (!exercise) {
      continue;
    }

    const sets = Array.isArray(row.sets) && row.sets.length
      ? row.sets.map((set) => ({
        weight: set?.weight === null || set?.weight === undefined ? '' : String(set.weight),
        reps: set?.reps === null || set?.reps === undefined ? '' : String(set.reps)
      }))
      : [{ weight: '', reps: '' }];

    nextEntries.push(buildLogEntryFromExercise(exercise, {
      sets,
      selectedTags: row.selected_tags || []
    }));
  }

  state.logEntries = nextEntries;
  renderLogEntries();
  logDayHydrated = true;
}

function initLogState() {
  logDayHydrated = false;
  if (!state.logDate) {
    state.logDate = isoTodayLocal();
  }
  renderLogDate();
  renderLogExercisePickerMuscleChips();
  renderLogExercisePickerList();
  renderLogTemplateList();
  renderLogEntries();
}

function renderLogDate() {
  const value = el('#log-date-value');
  const input = el('#log-date-input');
  const today = isoTodayLocal();

  if (input) {
    input.value = state.logDate || today;
    input.max = today;
  }
  if (value) {
    value.textContent = formatLogDate(state.logDate || today);
  }
}

function setLogExerciseModalVisibility(visible) {
  const modal = el('#log-exercise-modal');
  if (!modal) {
    return;
  }
  modal.classList.toggle('hidden', !visible);
}

function setLogTemplateModalVisibility(visible) {
  const modal = el('#log-template-modal');
  if (!modal) {
    return;
  }
  modal.classList.toggle('hidden', !visible);
}

function closeLogExerciseModal() {
  setLogExerciseModalVisibility(false);
}

function closeLogTemplateModal() {
  setLogTemplateModalVisibility(false);
}

function openLogExerciseModal() {
  state.logPickerSearch = '';
  state.logPickerMuscleFilter = '';
  state.logPickerSelectedExerciseIds = state.logEntries.map((entry) => entry.exerciseId);

  const input = el('#log-exercise-search');
  if (input) {
    input.value = '';
  }

  renderLogExercisePickerMuscleChips();
  renderLogExercisePickerList();
  setLogExerciseModalVisibility(true);
  input?.focus();
}

function openLogTemplateModal() {
  const available = nonEmptyTemplateDetails();
  if (!available.length) {
    state.logTemplateSelectionId = null;
  } else if (!available.some((row) => row.group.id === state.logTemplateSelectionId)) {
    state.logTemplateSelectionId = available[0].group.id;
  }
  renderLogTemplateList();
  setLogTemplateModalVisibility(true);
}

function renderLogExercisePickerMuscleChips() {
  const chips = el('#log-exercise-muscle-chips');
  if (!chips) {
    return;
  }

  const options = new Set();
  for (const exercise of state.exercises) {
    const primary = primaryMuscleForExercise(exercise);
    if (primary) {
      options.add(primary);
    }
  }

  const sorted = Array.from(options).sort((a, b) => a.localeCompare(b));
  const selected = state.logPickerMuscleFilter || '';

  chips.innerHTML = [''].concat(sorted)
    .map((value) => {
      const label = value || 'All';
      const active = selected === value;
      return `<button type="button" class="exercise-chip ${active ? 'active' : ''}" data-log-muscle-chip="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    })
    .join('');
}

function filteredLogExercises() {
  const search = normalizeText(state.logPickerSearch);
  const muscleFilter = normalizeText(state.logPickerMuscleFilter);

  return state.exercises.filter((exercise) => {
    const primary = primaryMuscleForExercise(exercise);
    const muscleMatch = !muscleFilter || normalizeText(primary) === muscleFilter;
    const suboptions = Array.isArray(exercise.suboptions) ? exercise.suboptions : [];
    const textMatch = !search
      || normalizeText(exercise.name).includes(search)
      || (Array.isArray(exercise.muscle_groups) && exercise.muscle_groups.some((group) => normalizeText(group).includes(search)))
      || suboptions.some((tag) => normalizeText(tag).includes(search));
    return muscleMatch && textMatch;
  });
}

function renderLogExercisePickerList() {
  const list = el('#log-exercise-picker-list');
  if (!list) {
    return;
  }

  const filtered = filteredLogExercises();
  if (!filtered.length) {
    list.innerHTML = '<p class="empty">No matching exercises.</p>';
    return;
  }

  list.innerHTML = filtered
    .map((exercise) => {
      const primary = primaryMuscleForExercise(exercise);
      const tags = exerciseDisplayTags(exercise, 2);
      const markerColor = exerciseColorForMuscleGroup(primary);
      const selected = state.logPickerSelectedExerciseIds.includes(exercise.id);

      return `
        <button type="button" class="template-picker-card ${selected ? 'active' : ''}" data-log-picker-exercise-id="${exercise.id}">
          <div class="template-picker-top">
            <span class="template-picker-icon">
              <span class="exercise-card-triangle" style="--triangle-color: ${markerColor}"></span>
            </span>
            <span class="exercise-pill template-picker-pill">${escapeHtml(primary)}</span>
          </div>
          <div class="template-picker-name">${escapeHtml(exercise.name)}</div>
          <div class="template-picker-meta">Primary: ${escapeHtml(primary)}</div>
          <div class="template-clean-tags">${tags.map((tag) => `<span class="template-picker-tag">${escapeHtml(tag)}</span>`).join('')}</div>
        </button>
      `;
    })
    .join('');
}

function saveLogExerciseSelection() {
  const selectedIds = Array.from(new Set(state.logPickerSelectedExerciseIds));
  const existingByExerciseId = new Map(state.logEntries.map((entry) => [entry.exerciseId, entry]));
  const nextEntries = [];

  for (const exerciseId of selectedIds) {
    const exercise = state.exercises.find((row) => row.id === exerciseId);
    if (!exercise) {
      continue;
    }
    nextEntries.push(buildLogEntryFromExercise(exercise, existingByExerciseId.get(exerciseId) || null));
  }

  state.logEntries = nextEntries;
  closeLogExerciseModal();
  renderLogEntries();
  schedulePersistLogDay();
}

function renderLogTemplateList() {
  const list = el('#log-template-list');
  const loadButton = el('#log-template-load');
  if (!list) {
    return;
  }

  const available = nonEmptyTemplateDetails();

  if (!available.length) {
    list.innerHTML = '<p class="empty">No templates with exercises available.</p>';
    if (loadButton) {
      loadButton.disabled = true;
    }
    return;
  }

  if (!available.some((row) => row.group.id === state.logTemplateSelectionId)) {
    state.logTemplateSelectionId = available[0].group.id;
  }
  if (loadButton) {
    loadButton.disabled = false;
  }

  list.innerHTML = available
    .map((detail) => {
      const { group, items } = detail;
      const count = items.length;
      const active = state.logTemplateSelectionId === group.id;
      const previewExercises = items
        .slice(0, 3)
        .map((item) => `<span class="log-template-preview-tag">${escapeHtml(item.exercise_name)}</span>`)
        .join('');
      return `
        <button
          type="button"
          class="log-template-option ${active ? 'active' : ''}"
          data-log-template-id="${group.id}"
        >
          <span class="log-template-option-main">
            <span class="log-template-name">${escapeHtml(group.name)}</span>
            <span class="log-template-preview-row">${previewExercises}</span>
          </span>
          <span class="log-template-count-wrap">
            <span class="log-template-count">${count} exercise${count === 1 ? '' : 's'}</span>
            <span class="log-template-check">${active ? 'Selected' : 'Select'}</span>
          </span>
        </button>
      `;
    })
    .join('');
}

async function loadSelectedTemplateIntoLog() {
  const groupId = state.logTemplateSelectionId;
  if (!groupId || !nonEmptyTemplateDetails().some((row) => row.group.id === groupId)) {
    setStatus('Select a template with exercises.', 'error');
    return;
  }

  const detail = await invoke('groups:get', { groupId });
  const seen = new Set();
  const entries = [];

  for (const item of detail.items) {
    if (seen.has(item.exercise_id)) {
      continue;
    }
    seen.add(item.exercise_id);
    const exercise = state.exercises.find((row) => row.id === item.exercise_id);
    if (!exercise) {
      continue;
    }
    entries.push(buildLogEntryFromExercise(exercise));
  }

  state.logEntries = entries;
  closeLogTemplateModal();
  renderLogEntries();
  schedulePersistLogDay();
}

function renderLogEntries() {
  const container = el('#log-exercise-list');
  if (!container) {
    return;
  }

  if (!state.logEntries.length) {
    container.innerHTML = `
      <div class="log-empty-card">
        <p class="empty">No exercises yet. Use Add Exercise or Load Template.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = state.logEntries
    .map((entry) => {
      const tagsHtml = entry.availableTags.length
        ? entry.availableTags
            .map((tag) => {
              const selected = entry.selectedTags.some((item) => normalizeText(item) === normalizeText(tag));
              return `
                <button
                  type="button"
                  class="log-tag-btn ${selected ? 'active' : ''}"
                  data-log-tag-exercise-id="${entry.exerciseId}"
                  data-log-tag-value="${escapeHtml(tag)}"
                >
                  ${escapeHtml(tag)}
                </button>
              `;
            })
            .join('')
        : '<span class="empty">No tags</span>';

      const rowsHtml = entry.sets
        .map(
          (set, index) => `
            <div class="log-set-row">
              <div class="log-set-cell log-set-index">Set ${index + 1}</div>
              <div class="log-set-cell">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  inputmode="decimal"
                  placeholder="kg"
                  value="${escapeHtml(set.weight)}"
                  data-log-weight-exercise-id="${entry.exerciseId}"
                  data-log-set-index="${index}"
                />
              </div>
              <div class="log-set-cell">
                <input
                  type="number"
                  min="0"
                  step="1"
                  inputmode="numeric"
                  placeholder="reps"
                  value="${escapeHtml(set.reps)}"
                  data-log-reps-exercise-id="${entry.exerciseId}"
                  data-log-set-index="${index}"
                />
              </div>
            </div>
          `
        )
        .join('');

      return `
        <article class="log-workout-card">
          <div class="log-workout-head">
            <div class="log-workout-title-row">
              <span class="exercise-card-icon">
                <span class="exercise-card-triangle" style="--triangle-color: ${entry.markerColor}"></span>
              </span>
              <h3>${escapeHtml(entry.name)}</h3>
            </div>
            <span class="exercise-pill">${escapeHtml(entry.primaryMuscle)}</span>
          </div>

          <div class="log-tag-row">${tagsHtml}</div>

          <div class="log-set-grid">
            <div class="log-set-head">
              <span>Set</span>
              <span>Weight</span>
              <span>Reps</span>
            </div>
            ${rowsHtml}
            <button type="button" class="log-add-set-btn" data-log-add-set="${entry.exerciseId}">+ Add Set</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function addSetToLogExercise(exerciseId) {
  const entry = state.logEntries.find((row) => row.exerciseId === exerciseId);
  if (!entry) {
    return;
  }
  entry.sets.push({ weight: '', reps: '' });
  renderLogEntries();
  schedulePersistLogDay();
}

function updateLogSetField(exerciseId, setIndex, field, value) {
  const entry = state.logEntries.find((row) => row.exerciseId === exerciseId);
  if (!entry || !entry.sets[setIndex]) {
    return;
  }
  entry.sets[setIndex][field] = value;
  schedulePersistLogDay();
}

function toggleLogTag(exerciseId, tagValue) {
  const entry = state.logEntries.find((row) => row.exerciseId === exerciseId);
  if (!entry) {
    return;
  }

  const tag = String(tagValue || '').trim();
  if (!tag || !entry.availableTags.some((item) => normalizeText(item) === normalizeText(tag))) {
    return;
  }

  const index = entry.selectedTags.findIndex((item) => normalizeText(item) === normalizeText(tag));
  if (index >= 0) {
    entry.selectedTags.splice(index, 1);
  } else {
    entry.selectedTags.push(tag);
    entry.selectedTags = normalizeUniqueTags(entry.selectedTags);
  }

  renderLogEntries();
  schedulePersistLogDay();
}

function bindForms() {
  const templateCreateToggle = el('#template-create-toggle');
  const templateModal = el('#template-name-modal');
  const templateNameForm = el('#template-name-form');
  const templateNameInput = el('#template-name-input');
  const templateNameClose = el('#template-name-close');

  const closeTemplateModal = () => {
    templateModal?.classList.add('hidden');
    templateNameForm?.reset();
  };

  templateCreateToggle?.addEventListener('click', () => {
    templateModal?.classList.remove('hidden');
    templateNameInput?.focus();
  });

  templateNameClose?.addEventListener('click', closeTemplateModal);

  templateModal?.addEventListener('click', (event) => {
    if (event.target === templateModal) {
      closeTemplateModal();
    }
  });

  templateNameForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const name = (fd.get('templateName') || '').toString().trim();
    if (!name) {
      return;
    }

    try {
      await invoke('groups:create', { name, description: null });
      closeTemplateModal();
      await refreshGroupsData();
      setStatus('Template created.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  const templateExerciseModal = el('#template-exercise-modal');
  const templateExerciseClose = el('#template-exercise-close');
  const templateExerciseCancel = el('#template-exercise-cancel');
  const templateExerciseSave = el('#template-exercise-save');
  const templateExerciseSearch = el('#template-exercise-search');

  templateExerciseClose?.addEventListener('click', closeTemplateExerciseModal);
  templateExerciseCancel?.addEventListener('click', closeTemplateExerciseModal);
  templateExerciseSave?.addEventListener('click', () => {
    saveTemplateExerciseSelection().catch((error) => setStatus(error.message, 'error'));
  });
  templateExerciseModal?.addEventListener('click', (event) => {
    if (event.target === templateExerciseModal) {
      closeTemplateExerciseModal();
    }
  });
  templateExerciseSearch?.addEventListener('input', (event) => {
    state.templatePickerSearch = event.target.value || '';
    renderTemplateExerciseList();
  });
  el('#template-exercise-muscle-chips')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-template-muscle-chip]');
    if (!chip) {
      return;
    }
    state.templatePickerMuscleFilter = chip.dataset.templateMuscleChip || '';
    renderTemplatePickerMuscleChips();
    renderTemplateExerciseList();
  });
  el('#template-exercise-list')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-template-picker-exercise-id]');
    if (!card) {
      return;
    }

    const exerciseId = Number.parseInt(card.dataset.templatePickerExerciseId, 10);
    if (!Number.isInteger(exerciseId)) {
      return;
    }

    const idx = state.templatePickerSelectedExerciseIds.indexOf(exerciseId);
    if (idx >= 0) {
      state.templatePickerSelectedExerciseIds.splice(idx, 1);
    } else {
      state.templatePickerSelectedExerciseIds.push(exerciseId);
    }
    renderTemplateExerciseList();
  });

  const logDateRow = el('.log-date-row');
  const logDateInput = el('#log-date-input');
  const logAddExerciseBtn = el('#log-add-exercise-btn');
  const logLoadTemplateBtn = el('#log-load-template-btn');

  logDateRow?.addEventListener('click', (event) => {
    event.preventDefault();
    if (typeof logDateInput?.showPicker === 'function') {
      logDateInput.showPicker();
      return;
    }
    logDateInput?.focus();
    logDateInput?.click();
  });

  logDateInput?.addEventListener('change', async (event) => {
    const picked = (event.target.value || '').trim();
    if (!picked || picked === state.logDate) {
      return;
    }

    try {
      await persistLogDay();
      state.logDate = picked;
      renderLogDate();
      await loadLogDayFromDb(picked);
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  logAddExerciseBtn?.addEventListener('click', openLogExerciseModal);
  logLoadTemplateBtn?.addEventListener('click', openLogTemplateModal);

  const logExerciseModal = el('#log-exercise-modal');
  const logExerciseSearch = el('#log-exercise-search');
  el('#log-exercise-close')?.addEventListener('click', closeLogExerciseModal);
  el('#log-exercise-cancel')?.addEventListener('click', closeLogExerciseModal);
  el('#log-exercise-save')?.addEventListener('click', saveLogExerciseSelection);

  logExerciseModal?.addEventListener('click', (event) => {
    if (event.target === logExerciseModal) {
      closeLogExerciseModal();
    }
  });

  logExerciseSearch?.addEventListener('input', (event) => {
    state.logPickerSearch = event.target.value || '';
    renderLogExercisePickerList();
  });

  el('#log-exercise-muscle-chips')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-log-muscle-chip]');
    if (!chip) {
      return;
    }
    state.logPickerMuscleFilter = chip.dataset.logMuscleChip || '';
    renderLogExercisePickerMuscleChips();
    renderLogExercisePickerList();
  });

  el('#log-exercise-picker-list')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-log-picker-exercise-id]');
    if (!card) {
      return;
    }
    const exerciseId = Number.parseInt(card.dataset.logPickerExerciseId, 10);
    if (!Number.isInteger(exerciseId)) {
      return;
    }

    const index = state.logPickerSelectedExerciseIds.indexOf(exerciseId);
    if (index >= 0) {
      state.logPickerSelectedExerciseIds.splice(index, 1);
    } else {
      state.logPickerSelectedExerciseIds.push(exerciseId);
    }
    renderLogExercisePickerList();
  });

  const logTemplateModal = el('#log-template-modal');
  el('#log-template-close')?.addEventListener('click', closeLogTemplateModal);
  el('#log-template-cancel')?.addEventListener('click', closeLogTemplateModal);
  el('#log-template-load')?.addEventListener('click', () => {
    loadSelectedTemplateIntoLog().catch((error) => setStatus(error.message, 'error'));
  });

  logTemplateModal?.addEventListener('click', (event) => {
    if (event.target === logTemplateModal) {
      closeLogTemplateModal();
    }
  });

  el('#log-template-list')?.addEventListener('click', (event) => {
    const option = event.target.closest('[data-log-template-id]');
    if (!option) {
      return;
    }
    const groupId = Number.parseInt(option.dataset.logTemplateId, 10);
    if (!Number.isInteger(groupId)) {
      return;
    }
    state.logTemplateSelectionId = groupId;
    renderLogTemplateList();
  });

  const logExerciseList = el('#log-exercise-list');
  logExerciseList?.addEventListener('click', (event) => {
    const tagButton = event.target.closest('[data-log-tag-exercise-id]');
    if (tagButton) {
      const exerciseId = Number.parseInt(tagButton.dataset.logTagExerciseId, 10);
      if (!Number.isInteger(exerciseId)) {
        return;
      }
      toggleLogTag(exerciseId, tagButton.dataset.logTagValue || '');
      return;
    }

    const addSetButton = event.target.closest('[data-log-add-set]');
    if (!addSetButton) {
      return;
    }
    const exerciseId = Number.parseInt(addSetButton.dataset.logAddSet, 10);
    if (!Number.isInteger(exerciseId)) {
      return;
    }
    addSetToLogExercise(exerciseId);
  });

  logExerciseList?.addEventListener('input', (event) => {
    const target = event.target;
    const weightExerciseId = target.dataset?.logWeightExerciseId;
    const repsExerciseId = target.dataset?.logRepsExerciseId;

    if (!weightExerciseId && !repsExerciseId) {
      return;
    }

    const exerciseId = Number.parseInt(weightExerciseId || repsExerciseId, 10);
    const setIndex = Number.parseInt(target.dataset.logSetIndex, 10);
    if (!Number.isInteger(exerciseId) || !Number.isInteger(setIndex)) {
      return;
    }

    if (weightExerciseId) {
      updateLogSetField(exerciseId, setIndex, 'weight', target.value);
      return;
    }
    updateLogSetField(exerciseId, setIndex, 'reps', target.value);
  });

  const caloriesMenuBtn = el('#calories-target-menu-btn');
  const caloriesOpenTargets = el('#calories-open-targets');
  const caloriesTargetModal = el('#calories-target-modal');
  const caloriesTargetClose = el('#calories-target-close');
  const caloriesTargetCancel = el('#calories-target-cancel');
  const caloriesTargetForm = el('#calories-target-form');
  const caloriesSearchInput = el('#calories-food-search');
  const caloriesSearchResults = el('#calories-food-results');
  const caloriesFoodModal = el('#calories-food-modal');
  const caloriesFoodClose = el('#calories-food-close');
  const caloriesFoodCancel = el('#calories-food-cancel');
  const caloriesFoodForm = el('#calories-food-form');
  const caloriesMonthPicker = el('#calories-month-picker');

  caloriesMenuBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setCaloriesTargetMenuVisibility(!state.caloriesMenuOpen);
  });

  caloriesOpenTargets?.addEventListener('click', () => {
    setCaloriesTargetMenuVisibility(false);
    openCaloriesTargetModal();
  });

  caloriesTargetClose?.addEventListener('click', closeCaloriesTargetModal);
  caloriesTargetCancel?.addEventListener('click', closeCaloriesTargetModal);

  caloriesTargetModal?.addEventListener('click', (event) => {
    if (event.target === caloriesTargetModal) {
      closeCaloriesTargetModal();
    }
  });

  caloriesTargetForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    const targetKcal = Number.parseFloat(String(fd.get('targetKcal') || '').trim());
    const targetProtein = Number.parseFloat(String(fd.get('targetProtein') || '').trim());

    if (!Number.isFinite(targetKcal) || !Number.isFinite(targetProtein) || targetKcal <= 0 || targetProtein <= 0) {
      setStatus('Target kcal and target protein must be greater than zero.', 'error');
      return;
    }

    try {
      const payload = await invoke('calories:targets:set', { targetKcal, targetProtein });
      state.caloriesTargets = normalizeCaloriesTargets(payload);
      renderCaloriesRings();
      closeCaloriesTargetModal();
      setStatus('Calories targets updated.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  caloriesSearchInput?.addEventListener('input', () => {
    const query = (caloriesSearchInput.value || '').trim();
    state.caloriesSearchQuery = query;

    if (caloriesSearchDebounceId) {
      clearTimeout(caloriesSearchDebounceId);
      caloriesSearchDebounceId = null;
    }

    if (!query) {
      state.caloriesSearchRequestId += 1;
      state.caloriesSearchResults = [];
      renderCaloriesSearchResults();
      return;
    }

    const requestId = state.caloriesSearchRequestId + 1;
    state.caloriesSearchRequestId = requestId;
    caloriesSearchDebounceId = setTimeout(async () => {
      try {
        const results = await invoke('calories:food:search', { query });
        if (requestId !== state.caloriesSearchRequestId) {
          return;
        }
        state.caloriesSearchResults = Array.isArray(results) ? results : [];
        renderCaloriesSearchResults();
      } catch (error) {
        if (requestId !== state.caloriesSearchRequestId) {
          return;
        }
        state.caloriesSearchResults = [];
        renderCaloriesSearchResults();
        setStatus(error.message, 'error');
      }
    }, 220);
  });

  caloriesSearchInput?.addEventListener('focus', () => {
    if (state.caloriesSearchQuery.trim().length >= 1) {
      renderCaloriesSearchResults();
    }
  });

  caloriesSearchResults?.addEventListener('click', (event) => {
    const option = event.target.closest('[data-calories-food-id]');
    if (!option) {
      return;
    }

    const food = {
      id: option.dataset.caloriesFoodId || '',
      title: option.dataset.caloriesFoodTitle || '',
      imageUrl: option.dataset.caloriesFoodImage || ''
    };
    if (!food.id || !food.title) {
      return;
    }

    openCaloriesFoodModal(food);
    state.caloriesSearchResults = [];
    setCaloriesSearchResultsVisibility(false);
    if (caloriesSearchInput) {
      caloriesSearchInput.value = food.title;
    }
  });

  caloriesFoodClose?.addEventListener('click', closeCaloriesFoodModal);
  caloriesFoodCancel?.addEventListener('click', closeCaloriesFoodModal);

  caloriesFoodModal?.addEventListener('click', (event) => {
    if (event.target === caloriesFoodModal) {
      closeCaloriesFoodModal();
    }
  });

  caloriesFoodForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state.caloriesSelectedFood?.id) {
      setStatus('Pick a food from search first.', 'error');
      return;
    }

    const formData = new FormData(event.target);
    const grams = Number.parseFloat(String(formData.get('grams') || '').trim());
    if (!Number.isFinite(grams) || grams <= 0) {
      setStatus('Grams must be greater than zero.', 'error');
      return;
    }

    try {
      await invoke('calories:food:add', {
        consumedOn: isoTodayLocal(),
        foodId: state.caloriesSelectedFood.id,
        title: state.caloriesSelectedFood.title,
        grams
      });
      closeCaloriesFoodModal();
      state.caloriesSelectedFood = null;
      state.caloriesSearchQuery = '';
      state.caloriesSearchResults = [];
      if (caloriesSearchInput) {
        caloriesSearchInput.value = '';
      }
      renderCaloriesSearchResults();
      await loadCaloriesDay();
      await loadCaloriesMonthChart();
      setStatus('Food added to today log.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  el('#calories-food-log-list')?.addEventListener('click', async (event) => {
    const repeatButton = event.target.closest('[data-calories-food-repeat]');
    if (repeatButton) {
      const foodId = repeatButton.dataset.caloriesFoodId || '';
      const title = repeatButton.dataset.caloriesFoodTitle || '';
      const imageUrl = repeatButton.dataset.caloriesFoodImage || '';
      if (!foodId || !title) {
        return;
      }
      openCaloriesFoodModal({ id: foodId, title, imageUrl }, '');
      return;
    }

    const deleteButton = event.target.closest('[data-calories-food-delete]');
    if (!deleteButton) {
      return;
    }

    const logId = Number.parseInt(deleteButton.dataset.caloriesFoodDelete, 10);
    if (!Number.isInteger(logId)) {
      return;
    }

    try {
      await invoke('calories:food:delete', {
        consumedOn: isoTodayLocal(),
        logId
      });
      await loadCaloriesDay();
      await loadCaloriesMonthChart();
      setStatus('Food removed from today log.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  caloriesMonthPicker?.addEventListener('change', () => {
    const value = String(caloriesMonthPicker.value || '').trim();
    if (!/^\d{4}-\d{2}$/.test(value)) {
      return;
    }
    state.caloriesChartMonth = value;
    loadCaloriesMonthChart().catch((error) => setStatus(error.message, 'error'));
  });

  const exerciseDrawerBackdrop = el('#exercise-drawer-backdrop');
  const openExerciseDrawer = el('#open-exercise-drawer');
  const closeExerciseDrawerBtn = el('#close-exercise-drawer');
  const addCustomSuboptionBtn = el('#add-custom-suboption');
  const customSuboptionInput = el('#exercise-custom-suboption');
  const availableSuboptionsList = el('#available-suboptions-list');

  const closeExerciseDrawer = () => {
    setExerciseDrawerVisibility(false);
    resetExerciseDrawerForm();
  };

  openExerciseDrawer?.addEventListener('click', openExerciseDrawerForCreate);

  closeExerciseDrawerBtn?.addEventListener('click', closeExerciseDrawer);

  exerciseDrawerBackdrop?.addEventListener('click', closeExerciseDrawer);

  const addCustomSuboption = async () => {
    const value = customSuboptionInput?.value?.trim();
    if (!value) {
      return;
    }

    const exists = state.globalExerciseTags.some((tag) => normalizeText(tag) === normalizeText(value));
    if (!exists) {
      await invoke('exercise-tags:create', { name: value });
      await refreshExercisesData();
    }

    if (customSuboptionInput) {
      customSuboptionInput.value = '';
      customSuboptionInput.focus();
    }
  };

  addCustomSuboptionBtn?.addEventListener('click', async () => {
    try {
      await addCustomSuboption();
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  customSuboptionInput?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    addCustomSuboption().catch((error) => setStatus(error.message, 'error'));
  });

  availableSuboptionsList?.addEventListener('click', async (event) => {
    const removeTag = event.target.closest('[data-remove-global-suboption]');
    if (removeTag) {
      event.preventDefault();
      event.stopPropagation();
      const tagName = (removeTag.dataset.removeGlobalSuboption || '').trim();
      if (!tagName) {
        return;
      }

      try {
        await invoke('exercise-tags:delete', { name: tagName });
        state.customExerciseSuboptions = state.customExerciseSuboptions.filter(
          (value) => normalizeText(value) !== normalizeText(tagName)
        );
        await refreshExercisesData();
      } catch (error) {
        setStatus(error.message, 'error');
      }
      return;
    }

    const button = event.target.closest('[data-global-suboption]');
    if (!button) {
      return;
    }

    const value = (button.dataset.globalSuboption || '').trim();
    if (!value) {
      return;
    }

    const key = normalizeText(value);
    const existingIndex = state.customExerciseSuboptions.findIndex((item) => normalizeText(item) === key);
    if (existingIndex >= 0) {
      state.customExerciseSuboptions.splice(existingIndex, 1);
    } else {
      state.customExerciseSuboptions.push(value);
    }

    renderAvailableExerciseSuboptions();
  });

  el('#exercise-drawer-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(event.target);
    try {
      const isEditing = Boolean(state.editingExerciseId);
      const muscleGroups = readCheckedValues('#exercise-drawer-form input[name="muscleGroup"]:checked');
      const suboptions = state.customExerciseSuboptions.slice();
      const basePayload = {
        name: fd.get('name'),
        type: 'general',
        notes: null,
        equipment: 'bodyweight',
        muscleGroups,
        suboptions
      };

      if (state.editingExerciseId) {
        await invoke('exercises:update', {
          exerciseId: state.editingExerciseId,
          ...basePayload
        });
      } else {
        await invoke('exercises:create', basePayload);
      }

      closeExerciseDrawer();
      await refreshExercisesData();
      await refreshGroupsData();
      setStatus(isEditing ? 'Exercise updated.' : 'Exercise added.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  const exerciseList = el('#exercise-list');
  exerciseList?.addEventListener('click', async (event) => {
    const trigger = event.target.closest('[data-exercise-menu-trigger]');
    if (trigger) {
      event.stopPropagation();
      const exerciseId = Number.parseInt(trigger.dataset.exerciseMenuTrigger, 10);
      state.openExerciseMenuId = state.openExerciseMenuId === exerciseId ? null : exerciseId;
      renderExercises();
      return;
    }

    const actionButton = event.target.closest('[data-exercise-action]');
    if (!actionButton) {
      return;
    }

    const action = actionButton.dataset.exerciseAction;
    const exerciseId = Number.parseInt(actionButton.dataset.exerciseId, 10);
    const exercise = state.exercises.find((item) => item.id === exerciseId);
    if (!exercise) {
      return;
    }

    if (action === 'edit') {
      openExerciseDrawerForEdit(exercise);
      renderExercises();
      return;
    }

    if (action === 'delete') {
      const approved = window.confirm(`Delete "${exercise.name}"?`);
      if (!approved) {
        return;
      }
      try {
        await invoke('exercises:delete', { exerciseId });
        state.openExerciseMenuId = null;
        await refreshExercisesData();
        await refreshGroupsData();
        setStatus('Exercise deleted.', 'ok');
      } catch (error) {
        setStatus(error.message, 'error');
      }
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.exercise-menu-shell') && state.openExerciseMenuId !== null) {
      state.openExerciseMenuId = null;
      renderExercises();
    }

    if (!event.target.closest('.calories-target-menu-shell') && state.caloriesMenuOpen) {
      setCaloriesTargetMenuVisibility(false);
    }

    if (!event.target.closest('.calories-search-shell')) {
      setCaloriesSearchResultsVisibility(false);
    }
  });

  el('#group-select')?.addEventListener('change', async (event) => {
    const groupId = event.target.value ? Number(event.target.value) : null;
    if (!groupId) {
      await selectTemplate(null);
      return;
    }
    await selectTemplate(groupId);
  });

  el('#templates-board')?.addEventListener('click', async (event) => {
    const addButton = event.target.closest('[data-add-exercise-id]');
    if (addButton) {
      openTemplateExerciseModal(Number(addButton.dataset.addExerciseId));
      return;
    }

    const deleteButton = event.target.closest('[data-delete-template-id]');
    if (!deleteButton) {
      return;
    }

    const groupId = Number.parseInt(deleteButton.dataset.deleteTemplateId, 10);
    if (!Number.isInteger(groupId)) {
      return;
    }

    const group = state.groups.find((row) => row.id === groupId);
    const templateName = group?.name || 'this template';
    const approved = window.confirm(`Delete template "${templateName}"?`);
    if (!approved) {
      return;
    }

    try {
      await invoke('groups:delete', { groupId });
      await refreshGroupsData();
      setStatus('Template deleted.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  el('#group-item-exercise-select')?.addEventListener('change', (event) => {
    populateGroupVariationSelect(Number(event.target.value));
  });

  el('#group-item-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!state.selectedGroupId) {
      setStatus('Select a template first.', 'error');
      return;
    }

    const fd = new FormData(event.target);
    try {
      await invoke('groups:add-item', {
        groupId: state.selectedGroupId,
        exerciseId: Number(fd.get('exerciseId')),
        variationId: fd.get('variationId') ? Number(fd.get('variationId')) : null,
        targetSets: Number(fd.get('targetSets')),
        targetReps: fd.get('targetReps')
      });
      event.target.reset();
      populateGroupVariationSelect(Number(el('#group-item-exercise-select').value));
      await refreshTemplatesBoard();
      await loadGroupItems();
      setStatus('Exercise added to template.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  el('#group-items')?.addEventListener('click', async (event) => {
    const removeButton = event.target.closest('[data-remove-item-id]');
    if (!removeButton) {
      return;
    }

    try {
      await invoke('groups:remove-item', { groupExerciseId: Number(removeButton.dataset.removeItemId) });
      await refreshTemplatesBoard();
      await loadGroupItems();
      setStatus('Exercise removed from template.', 'ok');
    } catch (error) {
      setStatus(error.message, 'error');
    }
  });

  el('#analytics-exercise-filter')?.addEventListener('change', (event) => {
    state.analyticsExerciseId = Number(event.target.value) || null;
    populateAnalyticsTagFilter();
    loadAnalytics().catch((error) => setStatus(error.message, 'error'));
  });

  el('#analytics-tag-filter')?.addEventListener('change', (event) => {
    state.analyticsTagFilter = event.target.value || '';
    loadAnalytics().catch((error) => setStatus(error.message, 'error'));
  });

  el('#analytics-value-type-filter')?.addEventListener('change', (event) => {
    const nextType = event.target.value || 'reps';
    if (!['reps', 'weight', 'volume'].includes(nextType)) {
      return;
    }
    state.analyticsValueType = nextType;
    loadAnalytics().catch((error) => setStatus(error.message, 'error'));
  });

  el('#tab-progress .analytics-periods')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-analytics-period]');
    if (!button) {
      return;
    }
    const nextPeriod = button.dataset.analyticsPeriod || 'month';
    if (nextPeriod !== 'month' && nextPeriod !== 'year') {
      return;
    }
    state.analyticsPeriod = nextPeriod;
    renderAnalyticsPeriodButtons();
    loadAnalytics().catch((error) => setStatus(error.message, 'error'));
  });

  el('#tab-progress .analytics-metrics')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-analytics-metric]');
    if (!button) {
      return;
    }
    const nextMetric = button.dataset.analyticsMetric || 'avg';
    if (nextMetric !== 'avg' && nextMetric !== 'max') {
      return;
    }
    state.analyticsMetric = nextMetric;
    renderAnalyticsPeriodButtons();
    loadAnalytics().catch((error) => setStatus(error.message, 'error'));
  });

  el('#exercise-search')?.addEventListener('input', () => {
    renderExercises();
  });

  el('#exercise-muscle-chips')?.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-muscle-chip]');
    if (!chip) {
      return;
    }

    const value = chip.dataset.muscleChip || '';
    state.exerciseMuscleFilter = value;
    renderExerciseMuscleChips();
    renderExercises();
  });
}

function renderCategories() {
  const list = el('#category-list');
  if (!list) {
    return;
  }
  if (!state.categories.length) {
    list.innerHTML = '<li class="empty">No categories yet.</li>';
    return;
  }

  list.innerHTML = state.categories
    .map((category) => `<li><span class="tag">${escapeHtml(category.name)}</span></li>`)
    .join('');
}

function renderExercises() {
  const container = el('#exercise-list');
  if (!container) {
    return;
  }

  const searchValue = normalizeText((el('#exercise-search')?.value || '').trim());
  const muscleFilter = normalizeText((state.exerciseMuscleFilter || '').trim());

  const filtered = state.exercises.filter((exercise) => {
    const muscleNames = Array.isArray(exercise.muscle_groups) ? exercise.muscle_groups : [];
    const suboptions = Array.isArray(exercise.suboptions) ? exercise.suboptions : [];
    const muscleMatch = muscleFilter
      ? muscleNames.some((name) => normalizeText(name) === muscleFilter)
      : true;
    const nameMatch = normalizeText(exercise.name).includes(searchValue);
    const textMatch = !searchValue
      || nameMatch
      || muscleNames.some((name) => normalizeText(name).includes(searchValue))
      || suboptions.some((name) => normalizeText(name).includes(searchValue));
    return muscleMatch && textMatch;
  });

  if (!filtered.length) {
    container.innerHTML = '<p class="empty">No matching exercises.</p>';
    return;
  }

  container.innerHTML = filtered
    .map((exercise) => {
      const muscleGroups = Array.isArray(exercise.muscle_groups) ? exercise.muscle_groups : [];
      const primaryMuscle = muscleGroups[0] || 'General';
      const secondaryMuscles = muscleGroups.slice(1);
      const suboptions = Array.isArray(exercise.suboptions) ? exercise.suboptions : [];
      const tags = secondaryMuscles.concat(suboptions).slice(0, 5);
      const isMenuOpen = state.openExerciseMenuId === exercise.id;
      const markerColor = exerciseColorForMuscleGroup(primaryMuscle);
      const tagsHtml = tags.length
        ? tags.map((name) => `<span class="exercise-small-tag">${escapeHtml(name)}</span>`).join('')
        : '<span class="empty">No tags</span>';

      return `
        <article class="exercise-library-card">
          <div class="exercise-card-top">
            <span class="exercise-card-icon">
              <span class="exercise-card-triangle" style="--triangle-color: ${markerColor}"></span>
            </span>
            <div class="exercise-card-top-right">
              <span class="exercise-pill">${escapeHtml(primaryMuscle)}</span>
              <div class="exercise-menu-shell">
                <button type="button" class="exercise-menu-trigger" data-exercise-menu-trigger="${exercise.id}" aria-label="Open exercise menu">⋯</button>
                <div class="exercise-card-menu ${isMenuOpen ? 'open' : ''}">
                  <button type="button" class="exercise-menu-item" data-exercise-action="edit" data-exercise-id="${exercise.id}">Edit</button>
                  <button type="button" class="exercise-menu-item delete" data-exercise-action="delete" data-exercise-id="${exercise.id}">Delete</button>
                </div>
              </div>
            </div>
          </div>
          <div class="exercise-library-title">${escapeHtml(exercise.name)}</div>
          <div class="exercise-library-meta">Primary: ${escapeHtml(primaryMuscle)}</div>
          <div class="exercise-tag-row">${tagsHtml}</div>
        </article>
      `;
    })
    .join('');
}

function populateExerciseFilters() {
  const chips = el('#exercise-muscle-chips');
  if (!chips) {
    return;
  }

  const allGroups = new Set();
  for (const exercise of state.exercises) {
    if (!Array.isArray(exercise.muscle_groups)) {
      continue;
    }
    for (const group of exercise.muscle_groups) {
      if (typeof group === 'string' && group.trim()) {
        allGroups.add(group.trim());
      }
    }
  }

  const sorted = Array.from(allGroups).sort((a, b) => a.localeCompare(b));
  state.exerciseMuscleOptions = sorted;

  if (state.exerciseMuscleFilter && !sorted.includes(state.exerciseMuscleFilter)) {
    state.exerciseMuscleFilter = '';
  }

  renderExerciseMuscleChips();
}

function renderExerciseMuscleChips() {
  const chips = el('#exercise-muscle-chips');
  if (!chips) {
    return;
  }

  const selected = state.exerciseMuscleFilter || '';
  const chipOptions = [''].concat(state.exerciseMuscleOptions);

  chips.innerHTML = chipOptions
    .map((value) => {
      const isActive = value === selected;
      const label = value || 'All';
      return `<button type="button" class="exercise-chip ${isActive ? 'active' : ''}" data-muscle-chip="${escapeHtml(value)}">${escapeHtml(label)}</button>`;
    })
    .join('');
}

function normalizeCaloriesTargets(payload) {
  const parsedKcal = Number(payload?.target_kcal ?? payload?.targetKcal);
  const parsedProtein = Number(payload?.target_protein ?? payload?.targetProtein);
  return {
    targetKcal: Number.isFinite(parsedKcal) && parsedKcal > 0 ? parsedKcal : 2200,
    targetProtein: Number.isFinite(parsedProtein) && parsedProtein > 0 ? parsedProtein : 150
  };
}

function setCaloriesTargetMenuVisibility(visible) {
  state.caloriesMenuOpen = Boolean(visible);
  el('#calories-target-menu')?.classList.toggle('hidden', !state.caloriesMenuOpen);
}

function setCaloriesTargetModalVisibility(visible) {
  el('#calories-target-modal')?.classList.toggle('hidden', !visible);
}

function setCaloriesFoodModalVisibility(visible) {
  el('#calories-food-modal')?.classList.toggle('hidden', !visible);
}

function setCaloriesSearchResultsVisibility(visible) {
  el('#calories-food-results')?.classList.toggle('hidden', !visible);
}

function renderCaloriesSelectedFoodPreview() {
  const container = el('#calories-selected-food-preview');
  if (!container) {
    return;
  }

  const selected = state.caloriesSelectedFood;
  if (!selected) {
    container.innerHTML = '<p class="empty">No food selected.</p>';
    return;
  }

  const unitTitles = Array.isArray(state.caloriesSelectedFoodUnits)
    ? state.caloriesSelectedFoodUnits
    : [];
  const unitsMarkup = state.caloriesSelectedFoodUnitsLoading
    ? '<p class="calories-selected-food-units">Loading unit options...</p>'
    : (unitTitles.length
      ? `<p class="calories-selected-food-units">${unitTitles.map((title) => escapeHtml(title)).join(' • ')}</p>`
      : '<p class="calories-selected-food-units">No unit options.</p>');

  container.innerHTML = `
    <img class="calories-search-thumb" src="${escapeHtml(selected.imageUrl)}" alt="${escapeHtml(selected.title)}" loading="lazy" />
    <div>
      <div class="calories-selected-food-title">${escapeHtml(selected.title)}</div>
      ${unitsMarkup}
    </div>
  `;
}

async function loadCaloriesSelectedFoodUnits(foodId) {
  const requestId = state.caloriesSelectedFoodUnitsRequestId + 1;
  state.caloriesSelectedFoodUnitsRequestId = requestId;
  state.caloriesSelectedFoodUnits = [];
  state.caloriesSelectedFoodUnitsLoading = true;
  renderCaloriesSelectedFoodPreview();

  try {
    const payload = await invoke('calories:food:units', { foodId });
    if (requestId !== state.caloriesSelectedFoodUnitsRequestId) {
      return;
    }
    state.caloriesSelectedFoodUnits = Array.isArray(payload) ? payload : [];
  } catch (error) {
    if (requestId !== state.caloriesSelectedFoodUnitsRequestId) {
      return;
    }
    state.caloriesSelectedFoodUnits = [];
    setStatus(error.message, 'error');
  } finally {
    if (requestId === state.caloriesSelectedFoodUnitsRequestId) {
      state.caloriesSelectedFoodUnitsLoading = false;
      renderCaloriesSelectedFoodPreview();
    }
  }
}

function openCaloriesFoodModal(food, defaultGrams = '100') {
  state.caloriesSelectedFood = food || null;
  state.caloriesSelectedFoodUnits = [];
  state.caloriesSelectedFoodUnitsLoading = false;
  renderCaloriesSelectedFoodPreview();
  const gramsInput = el('#calories-food-grams');
  if (gramsInput) {
    gramsInput.value = defaultGrams === null || defaultGrams === undefined ? '' : String(defaultGrams);
  }
  setCaloriesFoodModalVisibility(true);
  gramsInput?.focus();
  gramsInput?.select();

  if (state.caloriesSelectedFood?.id) {
    loadCaloriesSelectedFoodUnits(state.caloriesSelectedFood.id).catch((error) => setStatus(error.message, 'error'));
  }
}

function closeCaloriesFoodModal() {
  state.caloriesSelectedFoodUnitsRequestId += 1;
  state.caloriesSelectedFoodUnitsLoading = false;
  setCaloriesFoodModalVisibility(false);
}

function renderCaloriesSearchResults() {
  const container = el('#calories-food-results');
  if (!container) {
    return;
  }

  const query = String(state.caloriesSearchQuery || '').trim();
  const results = Array.isArray(state.caloriesSearchResults) ? state.caloriesSearchResults : [];

  if (!query) {
    container.innerHTML = '';
    setCaloriesSearchResultsVisibility(false);
    return;
  }

  if (!results.length) {
    container.innerHTML = '<p class="calories-search-empty">No results.</p>';
    setCaloriesSearchResultsVisibility(true);
    return;
  }

  container.innerHTML = results
    .map((item) => `
      <button
        type="button"
        class="calories-search-item"
        data-calories-food-id="${escapeHtml(item.id)}"
        data-calories-food-title="${escapeHtml(item.title)}"
        data-calories-food-image="${escapeHtml(item.imageUrl)}"
      >
        <img class="calories-search-thumb" src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" />
        <span class="calories-search-title">${escapeHtml(item.title)}</span>
      </button>
    `)
    .join('');
  setCaloriesSearchResultsVisibility(true);
}

function renderCaloriesFoodLog() {
  const list = el('#calories-food-log-list');
  if (!list) {
    return;
  }

  if (!state.caloriesFoodEntries.length) {
    list.innerHTML = '<p class="empty">No foods added today.</p>';
    return;
  }

  list.innerHTML = state.caloriesFoodEntries
    .map((entry) => {
      const image = typeof entry.image_url === 'string' ? entry.image_url.trim() : '';
      const thumb = image
        ? `<img class="calories-search-thumb" src="${escapeHtml(image)}" alt="${escapeHtml(entry.title)}" loading="lazy" />`
        : '<span class="calories-search-thumb calories-thumb-fallback" aria-hidden="true"></span>';
      return `
        <article class="calories-food-log-item">
          ${thumb}
          <div>
            <p class="calories-food-log-name">${escapeHtml(entry.title)}</p>
            <p class="calories-food-log-meta">${formatMetricNumber(entry.grams, 0)} g • +${formatMetricNumber(entry.kcal, 1)} kcal • +${formatMetricNumber(entry.protein, 1)} g protein</p>
          </div>
          <div class="calories-food-log-actions">
            <button
              type="button"
              class="calories-food-action-btn add"
              data-calories-food-repeat="${entry.id}"
              data-calories-food-id="${escapeHtml(entry.food_id || '')}"
              data-calories-food-title="${escapeHtml(entry.title || '')}"
              data-calories-food-image="${escapeHtml(entry.image_url || '')}"
              aria-label="Add this food again"
            >+</button>
            <button
              type="button"
              class="calories-food-action-btn delete"
              data-calories-food-delete="${entry.id}"
              aria-label="Delete food entry"
            >×</button>
          </div>
        </article>
      `;
    })
    .join('');
}

function openCaloriesTargetModal() {
  const kcalInput = el('#calories-target-kcal');
  const proteinInput = el('#calories-target-protein');

  if (kcalInput) {
    kcalInput.value = String(Math.round(state.caloriesTargets.targetKcal));
  }
  if (proteinInput) {
    proteinInput.value = String(Number(state.caloriesTargets.targetProtein.toFixed(1)));
  }

  setCaloriesTargetModalVisibility(true);
  kcalInput?.focus();
  kcalInput?.select();
}

function closeCaloriesTargetModal() {
  setCaloriesTargetModalVisibility(false);
}

function renderCaloriesRings() {
  const container = el('#calories-rings');
  if (!container) {
    return;
  }

  const consumedKcal = Math.max(0, Number(state.caloriesConsumed.kcal) || 0);
  const consumedProtein = Math.max(0, Number(state.caloriesConsumed.protein) || 0);
  const targets = normalizeCaloriesTargets(state.caloriesTargets);
  const kcalRatio = Math.max(0, Math.min(1, consumedKcal / Math.max(1, targets.targetKcal)));
  const proteinRatio = Math.max(0, Math.min(1, consumedProtein / Math.max(1, targets.targetProtein)));

  const outerRadius = 122;
  const innerRadius = 92;
  const outerCirc = 2 * Math.PI * outerRadius;
  const innerCirc = 2 * Math.PI * innerRadius;
  const outerDash = outerCirc * kcalRatio;
  const innerDash = innerCirc * proteinRatio;
  const outerCap = outerDash > 0 ? 'round' : 'butt';
  const innerCap = innerDash > 0 ? 'round' : 'butt';

  const kcalText = formatMetricNumber(consumedKcal, 1);
  const kcalTargetText = Math.round(targets.targetKcal).toLocaleString('en-US');
  const proteinText = formatMetricNumber(consumedProtein, 1);
  const proteinTargetText = Number(targets.targetProtein.toFixed(1)).toLocaleString('en-US');

  container.innerHTML = `
    <div class="calories-rings-stage">
      <svg class="calories-ring-svg" viewBox="0 0 380 380" role="img" aria-label="Daily calories and protein progress rings">
        <circle class="calories-ring-track" cx="190" cy="190" r="${outerRadius}" stroke-width="16"></circle>
        <circle class="calories-ring-progress kcal" cx="190" cy="190" r="${outerRadius}" stroke-width="16" stroke-linecap="${outerCap}" stroke-dasharray="${outerDash} ${outerCirc}"></circle>
        <circle class="calories-ring-track" cx="190" cy="190" r="${innerRadius}" stroke-width="14"></circle>
        <circle class="calories-ring-progress protein" cx="190" cy="190" r="${innerRadius}" stroke-width="14" stroke-linecap="${innerCap}" stroke-dasharray="${innerDash} ${innerCirc}"></circle>
      </svg>
      <div class="calories-rings-center">
        <p class="calories-eyebrow">Daily Quota</p>
        <p class="calories-main-label">ACTIVE</p>
        <p class="calories-kcal-line">${kcalText} / ${kcalTargetText} KCAL</p>
        <p class="calories-protein-line">${proteinText} / ${proteinTargetText} G PROTEIN</p>
      </div>
    </div>
  `;
}

async function loadCaloriesTargets() {
  const payload = await invoke('calories:targets:get');
  state.caloriesTargets = normalizeCaloriesTargets(payload);
  renderCaloriesRings();
}

async function loadCaloriesDay() {
  const consumedOn = isoTodayLocal();
  const [entries, summary] = await Promise.all([
    invoke('calories:food:list', { consumedOn }),
    invoke('calories:summary:get', { consumedOn })
  ]);

  state.caloriesFoodEntries = Array.isArray(entries) ? entries : [];
  state.caloriesConsumed = {
    kcal: Number(summary?.kcal) || 0,
    protein: Number(summary?.protein) || 0
  };

  renderCaloriesFoodLog();
  renderCaloriesRings();
}

function renderCaloriesMonthChart() {
  const container = el('#calories-month-chart');
  if (!container) {
    return;
  }

  const range = monthRangeFromValue(state.caloriesChartMonth || isoCurrentMonthLocal());
  const rows = Array.isArray(state.caloriesMonthlyPoints) ? state.caloriesMonthlyPoints : [];
  const byDate = new Map(rows.map((item) => [String(item.date), item]));
  const points = [];

  for (let day = 1; day <= range.endDay; day += 1) {
    const iso = `${range.month}-${String(day).padStart(2, '0')}`;
    const row = byDate.get(iso);
    points.push({
      date: iso,
      day,
      kcal: Number(row?.kcal) || 0,
      protein: Number(row?.protein) || 0
    });
  }

  const hasValues = points.some((item) => item.kcal > 0 || item.protein > 0);
  if (!hasValues) {
    container.innerHTML = '<p class="empty">No nutrition data for selected month yet.</p>';
    return;
  }

  const width = 1120;
  const height = 290;
  const padLeft = 48;
  const padRight = 22;
  const padTop = 18;
  const padBottom = 34;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const maxY = Math.max(1, ...points.map((item) => Math.max(item.kcal, item.protein)));
  const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0;
  const baselineY = padTop + plotHeight;

  const coords = points.map((item, idx) => {
    const x = padLeft + (points.length > 1 ? idx * xStep : plotWidth / 2);
    const kcalY = padTop + plotHeight - (item.kcal / maxY) * plotHeight;
    const proteinY = padTop + plotHeight - (item.protein / maxY) * plotHeight;
    return { ...item, x, kcalY, proteinY };
  });

  const yTicks = 4;

  const gridLines = Array.from({ length: yTicks + 1 }, (_entry, idx) => {
    const ratio = idx / yTicks;
    const y = padTop + ratio * plotHeight;
    const value = (maxY * (1 - ratio)).toFixed(0);
    return `<g><line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" class="calories-chart-grid-line" /><text x="${padLeft - 8}" y="${y + 4}" class="calories-chart-axis-label" text-anchor="end">${value}</text></g>`;
  }).join('');

  const markerCount = Math.min(7, coords.length);
  const markerIndices = markerCount === 1
    ? [0]
    : Array.from({ length: markerCount }, (_entry, idx) => Math.round((idx * (coords.length - 1)) / (markerCount - 1)));
  const xLabels = Array.from(new Set(markerIndices))
    .map((idx) => {
      const point = coords[idx];
      return `<text x="${point.x}" y="${height - 10}" class="calories-chart-axis-label" text-anchor="middle">${point.day}</text>`;
    })
    .join('');

  const lineOffset = Math.max(1.5, Math.min(5, xStep * 0.24));
  const stems = coords
    .map((item) => {
      const kcalX = item.x - lineOffset;
      const proteinX = item.x + lineOffset;
      const labelDate = escapeHtml(formatLogDate(item.date));
      const kcalValue = formatMetricNumber(item.kcal, 1);
      const proteinValue = formatMetricNumber(item.protein, 1);
      return `
        <g class="calories-chart-day">
          <line x1="${kcalX}" y1="${baselineY}" x2="${kcalX}" y2="${item.kcalY}" class="calories-chart-stem kcal">
            <title>${labelDate}: ${kcalValue} kcal</title>
          </line>
          <line x1="${proteinX}" y1="${baselineY}" x2="${proteinX}" y2="${item.proteinY}" class="calories-chart-stem protein">
            <title>${labelDate}: ${proteinValue} g protein</title>
          </line>
          <circle cx="${kcalX}" cy="${item.kcalY}" r="2.8" class="calories-chart-point kcal">
            <title>${labelDate}: ${kcalValue} kcal</title>
          </circle>
          <circle cx="${proteinX}" cy="${item.proteinY}" r="2.8" class="calories-chart-point protein">
            <title>${labelDate}: ${proteinValue} g protein</title>
          </circle>
        </g>
      `;
    })
    .join('');

  container.innerHTML = `
    <svg class="calories-month-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Monthly calories and protein trend">
      ${gridLines}
      ${stems}
      ${xLabels}
    </svg>
  `;
}

async function loadCaloriesMonthChart() {
  if (!state.caloriesChartMonth) {
    state.caloriesChartMonth = isoCurrentMonthLocal();
  }
  const monthPicker = el('#calories-month-picker');
  if (monthPicker) {
    monthPicker.value = state.caloriesChartMonth;
  }

  const payload = await invoke('calories:summary:month', { month: state.caloriesChartMonth });
  state.caloriesMonthlyPoints = Array.isArray(payload?.points) ? payload.points : [];
  renderCaloriesMonthChart();
}

function selectedAnalyticsExercise() {
  const exerciseId = Number(state.analyticsExerciseId);
  if (!Number.isInteger(exerciseId) || exerciseId <= 0) {
    return null;
  }
  return state.exercises.find((exercise) => exercise.id === exerciseId) || null;
}

function populateAnalyticsExerciseFilter() {
  const select = el('#analytics-exercise-filter');
  if (!select) {
    return;
  }

  if (!state.exercises.length) {
    state.analyticsExerciseId = null;
    select.innerHTML = '<option value="">No exercises</option>';
    return;
  }

  const hasCurrent = state.exercises.some((exercise) => exercise.id === Number(state.analyticsExerciseId));
  if (!hasCurrent) {
    state.analyticsExerciseId = state.exercises[0].id;
  }

  select.innerHTML = state.exercises
    .map((exercise) => `<option value="${exercise.id}">${escapeHtml(exercise.name)}</option>`)
    .join('');
  select.value = String(state.analyticsExerciseId);
}

function populateAnalyticsTagFilter() {
  const select = el('#analytics-tag-filter');
  if (!select) {
    return;
  }

  const exercise = selectedAnalyticsExercise();
  const tags = normalizeUniqueTags(exercise?.suboptions || []);

  if (!tags.length) {
    state.analyticsTagFilter = '';
    select.innerHTML = '<option value="">No tags</option>';
    select.disabled = true;
    return;
  }

  if (!tags.some((tag) => normalizeText(tag) === normalizeText(state.analyticsTagFilter))) {
    state.analyticsTagFilter = '';
  }

  select.innerHTML = ['<option value="">All tags</option>']
    .concat(tags.map((tag) => `<option value="${escapeHtml(tag)}">${escapeHtml(tag)}</option>`))
    .join('');
  select.value = state.analyticsTagFilter;
  select.disabled = false;
}

function renderAnalyticsPeriodButtons() {
  document.querySelectorAll('[data-analytics-period]').forEach((button) => {
    const active = button.dataset.analyticsPeriod === state.analyticsPeriod;
    button.classList.toggle('active', active);
  });

  document.querySelectorAll('[data-analytics-metric]').forEach((button) => {
    const active = button.dataset.analyticsMetric === state.analyticsMetric;
    button.classList.toggle('active', active);
  });
}

function renderAnalyticsChart(points = []) {
  const container = el('#analytics-chart');
  if (!container) {
    return;
  }

  const chartMap = {
    reps: {
      avgKey: 'reps_avg',
      maxKey: 'reps_max',
      label: 'Reps',
      unit: 'reps',
      emptyLabel: 'reps'
    },
    weight: {
      avgKey: 'weight_avg',
      maxKey: 'weight_max',
      label: 'Weight',
      unit: 'kg',
      emptyLabel: 'weight'
    },
    volume: {
      avgKey: 'volume_avg',
      maxKey: 'volume_max',
      label: 'Volume',
      unit: 'kg*reps',
      emptyLabel: 'volume'
    }
  };

  const config = chartMap[state.analyticsValueType] || chartMap.reps;

  if (!points.length) {
    container.innerHTML = `<p class="empty">No ${escapeHtml(config.emptyLabel)} data for selected filters.</p>`;
    return;
  }

  const metricKey = state.analyticsMetric === 'max' ? config.maxKey : config.avgKey;
  const metricLabel = state.analyticsMetric === 'max' ? `Max ${config.label}` : `Avg ${config.label}`;

  const width = 980;
  const height = 250;
  const padLeft = 40;
  const padRight = 16;
  const padTop = 18;
  const padBottom = 38;
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;

  const values = points.map((point) => Number(point[metricKey]) || 0);
  const maxValue = Math.max(1, ...values);
  const xStep = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const coords = points.map((point, index) => {
    const x = padLeft + (points.length > 1 ? index * xStep : plotWidth / 2);
    const value = Number(point[metricKey]) || 0;
    const y = padTop + plotHeight - (value / maxValue) * plotHeight;
    return { ...point, value, x, y };
  });

  const polyline = coords.map((point) => `${point.x},${point.y}`).join(' ');
  const yTicks = 4;
  const gridLines = Array.from({ length: yTicks + 1 }, (_row, idx) => {
    const ratio = idx / yTicks;
    const y = padTop + ratio * plotHeight;
    const value = (maxValue * (1 - ratio)).toFixed(0);
    return `<g><line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" class="analytics-grid-line" /><text x="${padLeft - 8}" y="${y + 4}" class="analytics-axis-label" text-anchor="end">${value}</text></g>`;
  }).join('');

  const markerCount = Math.min(6, coords.length);
  const markerIndexes = markerCount === 1
    ? [0]
    : Array.from({ length: markerCount }, (_entry, idx) => Math.round((idx * (coords.length - 1)) / (markerCount - 1)));
  const xLabels = Array.from(new Set(markerIndexes))
    .map((index) => {
      const point = coords[index];
      return `<text x="${point.x}" y="${height - 10}" class="analytics-axis-label" text-anchor="middle">${escapeHtml(formatChartDate(point.date))}</text>`;
    })
    .join('');

  const circles = coords
    .map((point) => `<circle cx="${point.x}" cy="${point.y}" r="4" class="analytics-point"><title>${escapeHtml(formatChartDate(point.date))}: ${point.value.toFixed(1)} ${escapeHtml(config.unit)}</title></circle>`)
    .join('');

  const metricTotal = values.reduce((sum, value) => sum + value, 0);
  const metricAvg = values.length ? metricTotal / values.length : 0;
  const metricPeak = values.length ? Math.max(...values) : 0;

  container.innerHTML = `
    <div class="analytics-stats">
      <div class="analytics-stat"><span>${metricLabel} Sum</span><strong>${metricTotal.toFixed(1)}</strong></div>
      <div class="analytics-stat"><span>${metricLabel} Avg</span><strong>${metricAvg.toFixed(1)}</strong></div>
      <div class="analytics-stat"><span>${metricLabel} Peak</span><strong>${metricPeak.toFixed(1)}</strong></div>
      <div class="analytics-stat"><span>Entries</span><strong>${values.length}</strong></div>
    </div>
    <svg class="analytics-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(config.label)} trend chart">
      ${gridLines}
      <polyline class="analytics-line" points="${polyline}" />
      ${circles}
      ${xLabels}
    </svg>
  `;
}

async function loadAnalytics() {
  const range = getAnalyticsRange(state.analyticsPeriod);
  const rangeLabel = el('#analytics-range-label');
  if (rangeLabel) {
    rangeLabel.textContent = range.label;
  }

  const exerciseId = Number(state.analyticsExerciseId);
  if (!Number.isInteger(exerciseId) || exerciseId <= 0) {
    renderAnalyticsChart([]);
    return;
  }

  const payload = await invoke('analytics:reps', {
    exerciseId,
    tag: state.analyticsTagFilter || null,
    startDate: range.startDate,
    endDate: range.endDate
  });

  renderAnalyticsPeriodButtons();
  renderAnalyticsChart(Array.isArray(payload?.points) ? payload.points : []);
}

function populateGroupSelects() {
  const groupSelect = el('#group-select');
  const options = state.groups.length
    ? state.groups.map((group) => `<option value="${group.id}">${escapeHtml(group.name)}</option>`).join('')
    : '<option value="">No templates</option>';

  if (groupSelect) {
    groupSelect.innerHTML = options;
  }

  if (state.groups.length) {
    const selected = state.selectedGroupId && state.groups.some((g) => g.id === state.selectedGroupId)
      ? state.selectedGroupId
      : state.groups[0].id;

    state.selectedGroupId = selected;
    if (groupSelect) {
      groupSelect.value = String(selected);
    }
  } else {
    state.selectedGroupId = null;
  }
}

function populateExerciseSelects() {
  const exerciseOptions = state.exercises.length
    ? state.exercises.map((exercise) => `<option value="${exercise.id}">${escapeHtml(exercise.name)}</option>`).join('')
    : '<option value="">No exercises</option>';

  const groupExerciseSelect = el('#group-item-exercise-select');
  if (groupExerciseSelect) {
    groupExerciseSelect.innerHTML = exerciseOptions;
  }

  const selectedExercise = Number(groupExerciseSelect?.value);
  populateGroupVariationSelect(selectedExercise);
}

function populateGroupVariationSelect(exerciseId) {
  const variationSelect = el('#group-item-variation-select');
  if (!variationSelect) {
    return;
  }
  const exercise = state.exercises.find((item) => item.id === exerciseId);

  const options = ['<option value="">No variation</option>'];
  if (exercise?.variations?.length) {
    for (const variation of exercise.variations) {
      options.push(`<option value="${variation.id}">${escapeHtml(variation.name)}</option>`);
    }
  }

  variationSelect.innerHTML = options.join('');
}

function renderTemplatesBoard() {
  const board = el('#templates-board');
  if (!board) {
    return;
  }

  if (!state.templateDetails.length) {
    board.innerHTML = `
      <div class="templates-empty">
        <p class="empty">No templates yet. Create your first template and add exercises.</p>
      </div>
    `;
    return;
  }

  board.innerHTML = state.templateDetails
    .map((payload) => {
      const { group, items } = payload;
      const itemCards = items.length
        ? items
            .map((item) => {
              const exercise = state.exercises.find((row) => row.id === item.exercise_id);
              const primary = primaryMuscleForExercise(exercise);
              const markerColor = exerciseColorForMuscleGroup(primary);
              const tags = Array.isArray(exercise?.suboptions) ? exercise.suboptions.slice(0, 2) : [];
              const tagHtml = tags.length
                ? `<div class="template-clean-tags">${tags.map((tag) => `<span class="exercise-small-tag">${escapeHtml(tag)}</span>`).join('')}</div>`
                : '';

              return `
                <div class="template-clean-exercise-card">
                  <div class="template-clean-top">
                    <span class="template-clean-icon">
                      <span class="exercise-card-triangle" style="--triangle-color: ${markerColor}"></span>
                    </span>
                    <span class="exercise-pill template-clean-pill">${escapeHtml(primary)}</span>
                  </div>
                  <div class="template-clean-exercise-name">${escapeHtml(item.exercise_name)}</div>
                  <div class="template-clean-exercise-meta">Primary: ${escapeHtml(primary)}</div>
                  ${tagHtml}
                </div>
              `;
            })
            .join('')
        : '';

      return `
        <article class="template-clean-row">
          <div class="template-clean-header">
            <div class="template-clean-title">${escapeHtml(group.name)}</div>
            <div class="template-clean-header-actions">
              <div class="template-clean-count">${items.length} exercise${items.length === 1 ? '' : 's'}</div>
              <button type="button" class="template-delete-btn" data-delete-template-id="${group.id}">Delete</button>
            </div>
          </div>
          <div class="template-clean-grid">
            ${itemCards}
            <button type="button" class="template-add-slot" data-add-exercise-id="${group.id}">
              <span>+</span>
              <strong>Add Exercise</strong>
            </button>
          </div>
        </article>
      `;
    })
    .join('');
}

async function refreshTemplatesBoard() {
  if (!state.groups.length) {
    state.templateDetails = [];
    renderTemplatesBoard();
    return;
  }

  const details = await Promise.all(
    state.groups.map((group) => invoke('groups:get', { groupId: group.id }).catch(() => null))
  );
  state.templateDetails = details.filter(Boolean);
  renderTemplatesBoard();
}

async function loadGroupItems() {
  const container = el('#group-items');
  if (!container) {
    return;
  }
  if (!state.selectedGroupId) {
    container.innerHTML = '<p class="empty">Select a template.</p>';
    return;
  }

  const payload = await invoke('groups:get', { groupId: state.selectedGroupId });
  if (!payload.items.length) {
    container.innerHTML = '<p class="empty">Template is empty.</p>';
    return;
  }

  container.innerHTML = payload.items
    .map((item) => {
      const variation = item.variation_name ? ` - ${escapeHtml(item.variation_name)}` : '';
      return `
        <div class="group-item-card row">
          <div>
            <strong>${escapeHtml(item.exercise_name)}${variation}</strong><br />
            <span class="muted">${item.target_sets} sets, target ${escapeHtml(item.target_reps || 'n/a')}</span>
          </div>
          <button class="danger" data-remove-item-id="${item.id}">Remove</button>
        </div>
      `;
    })
    .join('');
}

async function refreshExercisesData() {
  const [categories, exercises, globalTags] = await Promise.all([
    invoke('categories:list'),
    invoke('exercises:list'),
    invoke('exercise-tags:list')
  ]);
  state.categories = categories;
  state.exercises = exercises;
  state.globalExerciseTags = Array.isArray(globalTags)
    ? globalTags
        .map((row) => (typeof row?.name === 'string' ? row.name.trim() : ''))
        .filter(Boolean)
    : [];
  syncLogEntriesWithExercises();

  renderCategories();
  renderAvailableExerciseSuboptions();
  populateExerciseFilters();
  populateExerciseSelects();
  populateAnalyticsExerciseFilter();
  populateAnalyticsTagFilter();
  renderAnalyticsPeriodButtons();
  renderExercises();
  renderTemplatesBoard();
  renderLogExercisePickerMuscleChips();
  renderLogExercisePickerList();
  renderLogEntries();
  await loadAnalytics();
}

async function refreshGroupsData() {
  state.groups = await invoke('groups:list');
  populateGroupSelects();
  updateTemplateEditorTitle();
  await refreshTemplatesBoard();
  const available = nonEmptyTemplateDetails();
  if (!available.some((row) => row.group.id === state.logTemplateSelectionId)) {
    state.logTemplateSelectionId = available[0]?.group?.id ?? null;
  }
  await loadGroupItems();
  renderLogTemplateList();
}

async function init() {
  setupTabs();
  bindForms();
  initLogState();
  renderCaloriesRings();

  try {
    await maybeResetLegacyTemplates();
    state.caloriesChartMonth = isoCurrentMonthLocal();
    await Promise.all([refreshExercisesData(), refreshGroupsData(), loadCaloriesTargets(), loadCaloriesDay(), loadCaloriesMonthChart()]);
    await loadLogDayFromDb(state.logDate);
  } catch (error) {
    setStatus(error.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
