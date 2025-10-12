const STORAGE_KEYS = {
  journal: "dm_journal",
  todos: "dm_todos",
  settings: "dm_settings",
  logs: "dm_labLogs",
};

const TIMEZONE_OPTIONS = [
  { value: "Europe/London", label: "Europe/London" },
  { value: "Asia/Shanghai", label: "China" },
];

const DEFAULT_SETTINGS = {
  theme: "light",
  selectedDate: null,
  timeZone: TIMEZONE_OPTIONS[0].value,
};

const state = {
  journal: [],
  todos: [],
  labLogs: [],
  settings: { ...DEFAULT_SETTINGS },
  selectedDate: null,
  calendarAnchor: null,
  editingTodoId: null,
  editingJournalId: null,
  editingLogId: null,
};

const AUTOSIZE_MAX_HEIGHT = 280;

function normalizeLog(log) {
  const nextLog = { ...log };
  const createdSource =
    log?.createdAt ||
    log?.created_at ||
    log?.updatedAt ||
    (log?.steps || []).find((step) => step.time)?.time;
  const safeDate = log?.date || new Date().toISOString().slice(0, 10);
  const baseTime = typeof createdSource === "string" && createdSource.includes("T")
    ? createdSource
    : typeof createdSource === "string"
    ? `${safeDate}T${createdSource.slice(0, 5)}:00.000Z`
    : `${safeDate}T00:00:00.000Z`;
  nextLog.createdAt = log?.createdAt || baseTime;
  nextLog.updatedAt = log?.updatedAt || nextLog.createdAt;

  const mergedResults = [];
  if (log?.results) mergedResults.push(log.results);
  if (log?.parameters) mergedResults.push(`Parameters: ${log.parameters}`);
  if (log?.resources) mergedResults.push(`Code / Links: ${log.resources}`);
  nextLog.results = mergedResults.join("\n").trim();
  if (!nextLog.results) {
    delete nextLog.results;
  }
  delete nextLog.parameters;
  delete nextLog.resources;

  nextLog.steps = (log?.steps || [])
    .map((step) => {
      const id = step?.id || crypto.randomUUID();
      if (typeof step === "string") {
        const noteText = step.trim();
        if (!noteText) return null;
        return { id, note: noteText };
      }

      const rawNote = (step?.note || step?.detail || step?.commit || "").trim();
      let note = rawNote;
      let code = (step?.code || step?.codes || step?.url || step?.urls || step?.resources || "").trim();

      if (!code && note.includes("Code/URL:")) {
        const [notePart, ...codeParts] = note.split("Code/URL:");
        note = notePart.replace(/•\s*$/, "").trim();
        code = codeParts.join("Code/URL:").trim();
      }

      if (note.startsWith("Time ")) {
        const [, ...rest] = note.split("•");
        const cleaned = rest.join("•").trim();
        if (cleaned) {
          note = cleaned;
        }
      }

      if (!note && !code) return null;
      if (!note && code) {
        note = code;
        code = "";
      }

      const createdAt = normalizeStepCreatedAt(
        step?.createdAt || step?.timestamp || step?.timeStamp || step?.time || step?.addedAt,
        safeDate,
        nextLog.createdAt
      );

      const normalized = { id, note, createdAt };
      if (code) normalized.code = code;
      return normalized;
    })
    .filter(Boolean);

  return nextLog;
}

function autoResize(element) {
  if (!element) return;
  element.style.height = "auto";
  const max = Number(element.dataset.autosizeMax) || AUTOSIZE_MAX_HEIGHT;
  const newHeight = Math.min(max, element.scrollHeight || 0);
  element.style.height = `${newHeight}px`;
  element.style.overflowY = element.scrollHeight > max ? "auto" : "hidden";
}

function setupAutoResize(element) {
  if (!element) return;
  if (!element.dataset.autosizeBound) {
    element.dataset.autosizeBound = "true";
    element.addEventListener("input", () => autoResize(element));
    element.addEventListener("change", () => autoResize(element));
  }
  requestAnimationFrame(() => autoResize(element));
}

function refreshAutosizeWithin(root) {
  if (!root) return;
  const elements = root.matches?.("textarea.auto-resize") ? [root] : root.querySelectorAll?.("textarea.auto-resize");
  elements?.forEach((el) => setupAutoResize(el));
}

function getTimeZone() {
  return state.settings.timeZone || DEFAULT_SETTINGS.timeZone;
}

function getTimeZoneLabel(value) {
  return TIMEZONE_OPTIONS.find((item) => item.value === value)?.label || value;
}

function safeCssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

const formatter = {
  date(date) {
    const tz = getTimeZone();
    const base = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(base)
      .slice(0, 10);
  },
  time(date) {
    const tz = getTimeZone();
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).format(date instanceof Date ? date : new Date(`${date}T12:00:00Z`));
  },
  label(date) {
    const tz = getTimeZone();
    const base = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "long",
      day: "2-digit",
      weekday: "long",
    }).format(base);
  },
};

function normalizeStepCreatedAt(raw, safeDate, fallbackIso) {
  if (raw instanceof Date) {
    return raw.toISOString();
  }
  if (typeof raw === "number") {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed) {
      const direct = new Date(trimmed);
      if (!Number.isNaN(direct.getTime())) return direct.toISOString();
      if (/^\d{2}:\d{2}$/.test(trimmed)) {
        const baseDate = safeDate || fallbackIso?.slice(0, 10) || new Date().toISOString().slice(0, 10);
        const candidate = new Date(`${baseDate}T${trimmed}:00.000Z`);
        if (!Number.isNaN(candidate.getTime())) return candidate.toISOString();
      }
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        const candidate = new Date(`${trimmed}T00:00:00.000Z`);
        if (!Number.isNaN(candidate.getTime())) return candidate.toISOString();
      }
    }
  }
  if (fallbackIso) return fallbackIso;
  return new Date().toISOString();
}

function formatStepTimestamp(isoString) {
  if (!isoString) return "";
  const tz = getTimeZone();
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  const timePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  const datePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return `${timePart} ${datePart}`;
}

function refreshStepRowTimestamp(row) {
  if (!row) return;
  const timestampEl = row.querySelector(".step-timestamp");
  if (!timestampEl) return;
  timestampEl.textContent = formatStepTimestamp(row.dataset.stepCreated);
}

function refreshVisibleStepTimestamps(root = document) {
  const target = root || document;
  target.querySelectorAll?.(".log-step-row").forEach((row) => refreshStepRowTimestamp(row));
}

function nowInTimeZone() {
  const tz = getTimeZone();
  const iso = new Date().toLocaleString("sv-SE", {
    timeZone: tz,
  });
  const [date, time] = iso.split(" ");
  return { date, time: time.slice(0, 5) };
}

function loadState() {
  try {
    const journalRaw = localStorage.getItem(STORAGE_KEYS.journal);
    const todosRaw = localStorage.getItem(STORAGE_KEYS.todos);
    const settingsRaw = localStorage.getItem(STORAGE_KEYS.settings);
    const logsRaw = localStorage.getItem(STORAGE_KEYS.logs);
    if (journalRaw) state.journal = JSON.parse(journalRaw);
    if (todosRaw) state.todos = JSON.parse(todosRaw);
    if (settingsRaw) state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRaw) };
    if (logsRaw) state.labLogs = JSON.parse(logsRaw);
  } catch (error) {
    console.error("Failed to load local state", error);
  }
  if (!Array.isArray(state.labLogs)) {
    state.labLogs = [];
  }
  state.labLogs = state.labLogs.map((log) => normalizeLog(log));
  if (!TIMEZONE_OPTIONS.some((opt) => opt.value === state.settings.timeZone)) {
    state.settings.timeZone = DEFAULT_SETTINGS.timeZone;
  }
  const current = nowInTimeZone();
  state.selectedDate = state.settings.selectedDate || current.date;
  state.calendarAnchor = state.selectedDate;
}

function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function saveAll() {
  persist(STORAGE_KEYS.journal, state.journal);
  persist(STORAGE_KEYS.todos, state.todos);
  persist(STORAGE_KEYS.logs, state.labLogs);
}

function saveSettings() {
  persist(STORAGE_KEYS.settings, {
    theme: document.body.dataset.theme || "light",
    selectedDate: state.selectedDate,
    timeZone: getTimeZone(),
  });
}

function setupTheme() {
  const { theme } = state.settings;
  if (theme === "dark" || (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches)) {
    document.body.dataset.theme = "dark";
  } else {
    document.body.dataset.theme = "light";
  }
}

function toggleTheme() {
  const current = document.body.dataset.theme === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  document.body.dataset.theme = next;
  state.settings.theme = next;
  saveSettings();
}

function updateTimezoneDisplay() {
  const button = document.getElementById("timezoneButton");
  if (button) {
    const label = getTimeZoneLabel(getTimeZone());
    button.textContent = label;
    button.setAttribute("aria-label", `Current timezone: ${label}. Click to switch.`);
    button.setAttribute("title", `${label}`);
  }
  const menu = document.getElementById("timezoneMenu");
  if (menu) {
    menu.querySelectorAll("[data-value]").forEach((item) => {
      const isActive = item.dataset.value === getTimeZone();
      item.setAttribute("aria-selected", String(isActive));
      item.classList.toggle("active", isActive);
    });
  }
}

function setTimeZone(value) {
  if (!TIMEZONE_OPTIONS.some((item) => item.value === value)) return;
  if (value === getTimeZone()) return;
  state.settings.timeZone = value;
  updateTimezoneDisplay();
  document.getElementById("selectedDateLabel").textContent = formatter.label(state.selectedDate);
  if (document.getElementById("journalForm").hidden) {
    const now = nowInTimeZone();
    document.getElementById("journalDate").value = state.selectedDate || now.date;
    document.getElementById("journalTime").value = now.time;
  }
  renderCalendar();
  renderTodos();
  renderJournal();
  renderLogs();
  refreshVisibleStepTimestamps(document.getElementById("logForm"));
  saveSettings();
}

function setupTimezonePicker() {
  const picker = document.getElementById("timezonePicker");
  const button = document.getElementById("timezoneButton");
  const menu = document.getElementById("timezoneMenu");
  if (!picker || !button || !menu) return;

  updateTimezoneDisplay();

  function closeMenu() {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }

  function openMenu() {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
    updateTimezoneDisplay();
    const active = menu.querySelector(`[data-value="${safeCssEscape(getTimeZone())}"]`);
    active?.focus();
  }

  button.addEventListener("click", () => {
    if (menu.hidden) {
      openMenu();
    } else {
      closeMenu();
    }
  });

  button.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && menu.hidden) {
      event.preventDefault();
      openMenu();
    }
    if (event.key === "Escape" && !menu.hidden) {
      closeMenu();
    }
    if (event.key === "ArrowDown" && menu.hidden) {
      event.preventDefault();
      openMenu();
    }
  });

  menu.querySelectorAll("[data-value]").forEach((item) => {
    item.addEventListener("click", () => {
      setTimeZone(item.dataset.value);
      closeMenu();
      button.focus();
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setTimeZone(item.dataset.value);
        closeMenu();
        button.focus();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeMenu();
        button.focus();
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!menu.hidden && !picker.contains(event.target)) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Tab" && !menu.hidden) {
      const focusable = Array.from(menu.querySelectorAll("[data-value]"));
      if (!focusable.includes(document.activeElement)) {
        closeMenu();
      }
    }
  });
}

function setSelectedDate(date) {
  state.selectedDate = date;
  state.settings.selectedDate = date;
  state.calendarAnchor = date;
  document.getElementById("selectedDateLabel").textContent = formatter.label(date);
  document.getElementById("journalDate").value = date;
  const logDateInput = document.getElementById("logDate");
  if (logDateInput) logDateInput.value = date;
  closeTodoForm();
  closeJournalForm();
  closeLogForm();
  const exportFrom = document.getElementById("exportDateFrom");
  const exportTo = document.getElementById("exportDateTo");
  if (exportFrom && !exportFrom.value) exportFrom.value = date;
  if (exportTo && !exportTo.value) exportTo.value = date;
  renderTodos();
  renderJournal();
  renderLogs();
  renderCalendar();
  saveSettings();
}

function parseTags(input) {
  return input
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function openTodoForm(todo = null) {
  const form = document.getElementById("todoForm");
  const noteField = document.getElementById("todoNote");
  form.hidden = false;
  if (todo) {
    state.editingTodoId = todo.id;
    document.getElementById("todoTitle").value = todo.title;
    noteField.value = todo.note || "";
  } else {
    state.editingTodoId = null;
    form.reset();
    if (noteField) noteField.value = "";
  }
  setupAutoResize(noteField);
  document.getElementById("todoTitle").focus();
}

function closeTodoForm() {
  const form = document.getElementById("todoForm");
  const noteField = document.getElementById("todoNote");
  form.reset();
  state.editingTodoId = null;
  if (noteField) {
    noteField.value = "";
    setupAutoResize(noteField);
  }
  form.hidden = true;
}

function openJournalForm(entry = null) {
  const form = document.getElementById("journalForm");
  form.hidden = false;
  const now = nowInTimeZone();
  const date = state.selectedDate || now.date;
  const contentField = document.getElementById("journalContent");
  if (entry) {
    state.editingJournalId = entry.id;
    document.getElementById("journalDate").value = entry.date;
    document.getElementById("journalTime").value = entry.time;
    document.getElementById("journalTags").value = entry.tags?.join(", ") || "";
    contentField.value = entry.content;
  } else {
    state.editingJournalId = null;
    document.getElementById("journalForm").reset();
    document.getElementById("journalDate").value = date;
    document.getElementById("journalTime").value = now.time;
    contentField.value = "";
  }
  setupAutoResize(contentField);
  document.getElementById("journalContent").focus();
}

function closeJournalForm() {
  const form = document.getElementById("journalForm");
  form.reset();
  const now = nowInTimeZone();
  document.getElementById("journalDate").value = state.selectedDate || now.date;
  document.getElementById("journalTime").value = now.time;
  state.editingJournalId = null;
  const contentField = document.getElementById("journalContent");
  contentField.value = "";
  setupAutoResize(contentField);
  form.hidden = true;
}

function addLogStepRow(step = {}) {
  const container = document.getElementById("logStepsContainer");
  if (!container) return null;
  const row = document.createElement("div");
  row.className = "log-step-row";
  row.dataset.stepId = step.id || crypto.randomUUID();
  const createdAt = normalizeStepCreatedAt(
    step?.createdAt || step?.timestamp || step?.timeStamp || step?.time || step?.addedAt,
    state.selectedDate,
    null
  );
  row.dataset.stepCreated = createdAt;

  const actions = document.createElement("div");
  actions.className = "step-actions";

  const timestamp = document.createElement("span");
  timestamp.className = "step-timestamp";
  timestamp.textContent = formatStepTimestamp(createdAt);
  actions.appendChild(timestamp);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-step";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    row.remove();
    if (!container.querySelector(".log-step-row")) {
      addLogStepRow();
    }
  });
  actions.appendChild(removeBtn);

  const noteArea = document.createElement("textarea");
  noteArea.className = "step-note auto-resize";
  noteArea.rows = 1;
  noteArea.placeholder = "Commit or change";
  noteArea.required = true;
  noteArea.value = step.note || "";

  const codeArea = document.createElement("textarea");
  codeArea.className = "step-code auto-resize";
  codeArea.rows = 1;
  codeArea.placeholder = "Code notes or URLs";
  codeArea.value = step.code || "";

  row.appendChild(actions);
  row.appendChild(noteArea);
  row.appendChild(codeArea);

  container.appendChild(row);
  setupAutoResize(noteArea);
  setupAutoResize(codeArea);
  refreshStepRowTimestamp(row);
  return row;
}

function resetLogSteps(steps = []) {
  const container = document.getElementById("logStepsContainer");
  if (!container) return;
  container.innerHTML = "";
  if (!steps.length) {
    addLogStepRow();
  } else {
    steps.forEach((step) => addLogStepRow(step));
  }
  refreshAutosizeWithin(container);
}

function openLogForm(log = null) {
  const form = document.getElementById("logForm");
  if (!form) return;
  form.hidden = false;
  const now = nowInTimeZone();
  const date = state.selectedDate || now.date;
  state.editingLogId = log ? log.id : null;
  document.getElementById("logTitle").value = log?.title || "";
  document.getElementById("logDate").value = log?.date || date;
  document.getElementById("logDescription").value = log?.description || "";
  document.getElementById("logResults").value = log?.results || "";
  const defaultSteps = log?.steps?.length ? log.steps : [{}];
  resetLogSteps(defaultSteps);
  refreshAutosizeWithin(form);
  refreshVisibleStepTimestamps(form);
  document.getElementById("logTitle").focus();
}

function closeLogForm() {
  const form = document.getElementById("logForm");
  if (!form) return;
  form.reset();
  state.editingLogId = null;
  resetLogSteps([]);
  refreshAutosizeWithin(form);
  refreshVisibleStepTimestamps(form);
  const now = nowInTimeZone();
  const logDate = document.getElementById("logDate");
  if (logDate) {
    logDate.value = state.selectedDate || now.date;
  }
  form.hidden = true;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function getLogSortKey(log) {
  if (log.createdAt) return log.createdAt;
  if (log.updatedAt) return log.updatedAt;
  return `${log.date || "0000-00-00"}T00:00:00.000Z`;
}

function upsertJournal(entry) {
  const existingIdx = state.journal.findIndex((item) => item.id === entry.id);
  if (existingIdx >= 0) {
    state.journal.splice(existingIdx, 1, entry);
  } else {
    state.journal.push(entry);
  }
  state.journal.sort((a, b) => {
    if (a.date === b.date) {
      return a.time.localeCompare(b.time) || a.id.localeCompare(b.id);
    }
    return a.date.localeCompare(b.date);
  });
  persist(STORAGE_KEYS.journal, state.journal);
}

function upsertTodo(todo) {
  const sameDateTodos = state.todos.filter((t) => t.date === todo.date);
  if (!Number.isInteger(Number(todo.order))) {
    const maxOrder = sameDateTodos.reduce((max, t) => Math.max(max, t.order || 0), 0);
    todo.order = maxOrder + 1;
  }
  const idx = state.todos.findIndex((t) => t.id === todo.id);
  if (idx >= 0) {
    state.todos.splice(idx, 1, todo);
  } else {
    state.todos.push(todo);
  }
  normalizeOrders(todo.date);
  persist(STORAGE_KEYS.todos, state.todos);
}

function upsertLog(log) {
  const existingIdx = state.labLogs.findIndex((item) => item.id === log.id);
  if (existingIdx >= 0) {
    state.labLogs.splice(existingIdx, 1, log);
  } else {
    state.labLogs.push(log);
  }
  state.labLogs.sort((a, b) => {
    if (a.date === b.date) {
      return getLogSortKey(a).localeCompare(getLogSortKey(b)) || a.title.localeCompare(b.title);
    }
    return a.date.localeCompare(b.date);
  });
  persist(STORAGE_KEYS.logs, state.labLogs);
}

function normalizeOrders(date) {
  const sameDate = state.todos.filter((t) => t.date === date).sort((a, b) => a.order - b.order);
  sameDate.forEach((todo, index) => {
    todo.order = index + 1;
  });
  persist(STORAGE_KEYS.todos, state.todos);
}

function deleteTodo(id) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;
  state.todos = state.todos.filter((t) => t.id !== id);
  normalizeOrders(todo.date);
  saveAll();
  renderTodos();
  renderCalendar();
}

function deleteJournal(id) {
  state.journal = state.journal.filter((entry) => entry.id !== id);
  saveAll();
  renderJournal();
  renderCalendar();
}

function deleteLog(id) {
  state.labLogs = state.labLogs.filter((log) => log.id !== id);
  persist(STORAGE_KEYS.logs, state.labLogs);
  renderLogs();
  renderCalendar();
}

function getGlobalSearchTerm() {
  const input = document.getElementById("globalSearch");
  return input ? input.value.trim().toLowerCase() : "";
}

function filteredTodos() {
  const search = getGlobalSearchTerm();
  const statusEl = document.getElementById("filterStatus");
  const dateFromEl = document.getElementById("filterDateFrom");
  const dateToEl = document.getElementById("filterDateTo");
  const tagsEl = document.getElementById("filterTags");
  const status = statusEl ? statusEl.value : "all";
  const dateFrom = dateFromEl ? dateFromEl.value : "";
  const dateTo = dateToEl ? dateToEl.value : "";
  const tags = parseTags((tagsEl?.value || "").toLowerCase());

  return state.todos.filter((todo) => {
    if (dateFrom && todo.date < dateFrom) return false;
    if (dateTo && todo.date > dateTo) return false;
    if (status === "pending" && todo.done) return false;
    if (status === "done" && !todo.done) return false;

    const haystack = `${todo.title} ${todo.note}`.toLowerCase();
    const tagMatch = tags.length
      ? tags.every((tag) => haystack.includes(tag) || (todo.tags || []).some((t) => t.toLowerCase().includes(tag)))
      : true;
    const searchMatch = search ? haystack.includes(search) : true;

    return tagMatch && searchMatch;
  });
}

function filteredJournal() {
  const search = getGlobalSearchTerm();
  const dateFromEl = document.getElementById("filterDateFrom");
  const dateToEl = document.getElementById("filterDateTo");
  const tagsEl = document.getElementById("filterTags");
  const dateFrom = dateFromEl ? dateFromEl.value : "";
  const dateTo = dateToEl ? dateToEl.value : "";
  const tags = parseTags((tagsEl?.value || "").toLowerCase());

  return state.journal.filter((entry) => {
    if (dateFrom && entry.date < dateFrom) return false;
    if (dateTo && entry.date > dateTo) return false;
    const content = entry.content.toLowerCase();
    const tagsString = (entry.tags || []).join(" ").toLowerCase();

    const tagMatch = tags.length ? tags.every((tag) => tagsString.includes(tag)) : true;
    const searchMatch = search ? content.includes(search) || tagsString.includes(search) : true;

    return tagMatch && searchMatch;
  });
}

function renderTodos() {
  const list = document.getElementById("todoList");
  list.innerHTML = "";
  const template = document.getElementById("todoItemTemplate");
  const todos = filteredTodos().filter((todo) => todo.date === state.selectedDate);
  const fragment = document.createDocumentFragment();

  todos.sort((a, b) => a.order - b.order);

  todos.forEach((todo) => {
    const node = template.content.firstElementChild.cloneNode(true);
    node.dataset.id = todo.id;
    const checkbox = node.querySelector(".todo-done");
    checkbox.checked = !!todo.done;
    checkbox.setAttribute("aria-label", todo.done ? "Mark as incomplete" : "Mark as complete");
    const titleEl = node.querySelector(".todo-title");
    titleEl.textContent = todo.title;
    titleEl.classList.toggle("done", todo.done);
    const metaEl = node.querySelector(".todo-meta");
    metaEl.innerHTML = "";
    if (todo.note) {
      const noteSpan = document.createElement("span");
      noteSpan.textContent = todo.note;
      noteSpan.className = "note-text";
      noteSpan.title = todo.note;
      metaEl.appendChild(noteSpan);
    } else {
      metaEl.remove();
    }
    fragment.appendChild(node);
  });

  list.appendChild(fragment);
  attachTodoEvents();
}

function renderJournal() {
  const list = document.getElementById("journalTimeline");
  list.innerHTML = "";
  const template = document.getElementById("journalItemTemplate");
  const entries = filteredJournal().filter((entry) => entry.date === state.selectedDate);
  const fragment = document.createDocumentFragment();

  entries
    .slice()
    .sort((a, b) => a.time.localeCompare(b.time))
    .forEach((entry) => {
      const node = template.content.firstElementChild.cloneNode(true);
      node.dataset.id = entry.id;
      const contentEl = node.querySelector(".journal-content");
      const contentId = `journal-content-${entry.id}`;
      contentEl.id = contentId;
      contentEl.textContent = entry.content;
      if (entry.content.length > 160) {
        contentEl.classList.add("collapsed");
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "inline-link toggle-journal";
        toggle.textContent = "Expand";
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", contentId);
        toggle.addEventListener("click", () => {
          const collapsed = contentEl.classList.toggle("collapsed");
          toggle.textContent = collapsed ? "Expand" : "Collapse";
          toggle.setAttribute("aria-expanded", String(!collapsed));
          if (!collapsed) {
            contentEl.textContent = entry.content;
          }
        });
        contentEl.after(toggle);
      }
      const metaEl = node.querySelector(".journal-meta");
      metaEl.innerHTML = "";
      const timeSpan = document.createElement("span");
      timeSpan.textContent = formatTime(entry.time);
      metaEl.appendChild(timeSpan);
      if (entry.tags?.length) {
        const tagsSpan = document.createElement("span");
        tagsSpan.textContent = entry.tags.map((tag) => `#${tag}`).join(" ");
        tagsSpan.className = "note-text";
        metaEl.appendChild(tagsSpan);
      }
      fragment.appendChild(node);
    });

  list.appendChild(fragment);
  attachJournalEvents();
}

function renderLogs() {
  const list = document.getElementById("logList");
  if (!list) return;
  list.innerHTML = "";
  const template = document.getElementById("logItemTemplate");
  if (!template) return;
  const logs = state.labLogs.slice();
  if (!logs.length) return;

  const fragment = document.createDocumentFragment();

  logs
    .slice()
    .sort((a, b) => getLogSortKey(a).localeCompare(getLogSortKey(b)) || a.title.localeCompare(b.title))
    .forEach((log) => {
      const node = template.content.firstElementChild.cloneNode(true);
      node.dataset.id = log.id;

      const titleEl = node.querySelector(".log-title");
      titleEl.textContent = log.title;

      const metaEl = node.querySelector(".log-meta");
      metaEl.innerHTML = "";
      const dateSpan = document.createElement("span");
      dateSpan.textContent = log.date;
      metaEl.appendChild(dateSpan);
      const stepsSpan = document.createElement("span");
      stepsSpan.textContent = `${log.steps?.length || 0} step${log.steps?.length === 1 ? "" : "s"}`;
      metaEl.appendChild(stepsSpan);

      const descriptionEl = node.querySelector(".log-description");
      if (log.description) {
        descriptionEl.textContent = log.description;
      } else {
        descriptionEl.remove();
      }

      const operationsEl = node.querySelector(".log-operations");
      operationsEl.innerHTML = "";
      if (log.steps?.length) {
        log.steps.forEach((step) => {
          const item = document.createElement("li");
          item.dataset.stepId = step.id;
          if (step.createdAt) {
            const header = document.createElement("div");
            header.className = "log-step-header";
            const timeLabel = document.createElement("span");
            timeLabel.className = "log-step-time";
            timeLabel.textContent = formatStepTimestamp(step.createdAt);
            header.appendChild(timeLabel);
            item.appendChild(header);
          }
          const detail = document.createElement("div");
          detail.className = "log-step-detail";
          detail.textContent = step.note;
          item.appendChild(detail);
          if (step.code) {
            const codeBlock = document.createElement("div");
            codeBlock.className = "log-step-code";
            codeBlock.textContent = step.code;
            item.appendChild(codeBlock);
          }
          operationsEl.appendChild(item);
        });
      } else {
        operationsEl.remove();
      }

      const resultsEl = node.querySelector(".log-results");
      if (log.results) {
        resultsEl.innerHTML = "";
        const label = document.createElement("strong");
        label.textContent = "Results";
        const body = document.createElement("div");
        body.textContent = log.results;
        resultsEl.append(label, body);
      } else {
        resultsEl.remove();
      }

      fragment.appendChild(node);
    });

  list.appendChild(fragment);
  attachLogEvents();
}

function attachTodoEvents() {
  const list = document.getElementById("todoList");

  list.querySelectorAll(".todo-item").forEach((item) => {
    item.addEventListener("dragstart", handleDragStart);
    item.addEventListener("dragover", handleDragOver);
    item.addEventListener("drop", handleDrop);
    item.addEventListener("dragend", handleDragEnd);
  });

  list.querySelectorAll(".todo-done").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const id = event.target.closest(".todo-item").dataset.id;
      const todo = state.todos.find((t) => t.id === id);
      if (!todo) return;
      todo.done = event.target.checked;
      persist(STORAGE_KEYS.todos, state.todos);
      renderTodos();
      renderCalendar();
    });
  });

  list.querySelectorAll(".item-actions .edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".todo-item").dataset.id;
      const todo = state.todos.find((t) => t.id === id);
      if (!todo) return;
      openTodoForm(todo);
    });
  });

  list.querySelectorAll(".item-actions .delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".todo-item").dataset.id;
      if (confirm("Delete this todo?")) {
        deleteTodo(id);
        showToast("Todo deleted");
      }
    });
  });

  list.querySelectorAll(".item-actions .up").forEach((btn) => {
    btn.addEventListener("click", () => moveTodo(btn.closest(".todo-item").dataset.id, -1));
  });

  list.querySelectorAll(".item-actions .down").forEach((btn) => {
    btn.addEventListener("click", () => moveTodo(btn.closest(".todo-item").dataset.id, 1));
  });
}

function moveTodo(id, delta) {
  const todo = state.todos.find((t) => t.id === id);
  if (!todo) return;
  const todos = state.todos.filter((t) => t.date === todo.date).sort((a, b) => a.order - b.order);
  const index = todos.findIndex((t) => t.id === id);
  const swap = todos[index + delta];
  if (!swap) return;
  const temp = todo.order;
  todo.order = swap.order;
  swap.order = temp;
  persist(STORAGE_KEYS.todos, state.todos);
  normalizeOrders(todo.date);
  renderTodos();
  renderCalendar();
}

function attachJournalEvents() {
  document.querySelectorAll(".journal-item .edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".journal-item").dataset.id;
      const entry = state.journal.find((j) => j.id === id);
      if (!entry) return;
      openJournalForm(entry);
    });
  });

  document.querySelectorAll(".journal-item .delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".journal-item").dataset.id;
      if (confirm("Delete this journal entry?")) {
        deleteJournal(id);
        showToast("Journal entry deleted");
      }
    });
  });
}

function attachLogEvents() {
  document.querySelectorAll(".log-item .edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".log-item").dataset.id;
      const log = state.labLogs.find((item) => item.id === id);
      if (!log) return;
      openLogForm(log);
    });
  });

  document.querySelectorAll(".log-item .delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".log-item").dataset.id;
      if (confirm("Delete this research log?")) {
        deleteLog(id);
        showToast("Research log deleted");
      }
    });
  });
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  const label = document.getElementById("calendarLabel");
  const anchor = new Date(state.calendarAnchor + "T00:00:00");
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstWeekday = (firstDay.getUTCDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  const labelDate = new Date(Date.UTC(year, month, 1));
  label.textContent = labelDate.toLocaleString("en-GB", { month: "long", year: "numeric" });

  for (let i = 0; i < totalCells; i++) {
    if (i < firstWeekday || i >= firstWeekday + daysInMonth) {
      const placeholder = document.createElement("div");
      placeholder.className = "calendar-day placeholder";
      placeholder.setAttribute("aria-hidden", "true");
      grid.appendChild(placeholder);
      continue;
    }

    const day = i - firstWeekday + 1;
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day";
    cell.dataset.date = date;
    cell.setAttribute("role", "gridcell");
    cell.innerHTML = `<span class="day-number">${String(day).padStart(2, "0")}</span>`;

    const hasContent =
      state.todos.some((t) => t.date === date) ||
      state.journal.some((j) => j.date === date) ||
      state.labLogs.some((log) => log.date === date);
    if (hasContent) {
      const star = document.createElement("span");
      star.className = "day-star";
      star.textContent = "★";
      star.setAttribute("aria-hidden", "true");
      cell.appendChild(star);
      cell.setAttribute("aria-label", `${date} has entries`);
      cell.title = `${date} has entries`;
    } else {
      cell.setAttribute("aria-label", date);
      cell.title = date;
    }

    if (date === state.selectedDate) {
      cell.classList.add("selected");
      cell.setAttribute("aria-selected", "true");
    }

    cell.addEventListener("click", () => setSelectedDate(date));
    grid.appendChild(cell);
  }
}

function changeCalendarPeriod(offset) {
  const anchor = new Date(state.calendarAnchor + "T00:00:00");
  anchor.setUTCDate(1);
  anchor.setUTCMonth(anchor.getUTCMonth() + offset);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const monthStr = `${year}-${String(month + 1).padStart(2, "0")}`;
  state.calendarAnchor = `${monthStr}-01`;
  const selected = state.selectedDate;
  if (!selected || !selected.startsWith(monthStr)) {
    const currentDay = selected ? Number(selected.slice(8)) : 1;
    const daysInTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const newDay = Math.min(currentDay || 1, daysInTarget);
    setSelectedDate(`${monthStr}-${String(newDay).padStart(2, "0")}`);
  } else {
    renderCalendar();
  }
}

function setupEventHandlers() {
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  ["filterDateFrom", "filterDateTo", "filterStatus", "filterTags"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      renderTodos();
      renderJournal();
      renderCalendar();
    });
  });

  document.getElementById("prevPeriod").addEventListener("click", () => changeCalendarPeriod(-1));
  document.getElementById("nextPeriod").addEventListener("click", () => changeCalendarPeriod(1));

  document.getElementById("todoForm").addEventListener("submit", handleTodoSubmit);
  document.getElementById("cancelTodo").addEventListener("click", () => {
    closeTodoForm();
  });

  document.getElementById("journalForm").addEventListener("submit", handleJournalSubmit);
  document.getElementById("cancelJournal").addEventListener("click", () => {
    closeJournalForm();
  });

  document.getElementById("logForm").addEventListener("submit", handleLogSubmit);
  document.getElementById("cancelLog").addEventListener("click", () => {
    closeLogForm();
  });
  const addStepBtn = document.getElementById("addLogStep");
  if (addStepBtn) {
    addStepBtn.addEventListener("click", () => {
      const row = addLogStepRow();
      row?.querySelector(".step-note")?.focus();
    });
  }
  document.getElementById("logForm").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeLogForm();
    }
  });

  document.getElementById("journalContent").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.getElementById("journalForm").requestSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeJournalForm();
    }
  });

  document.getElementById("todoNote").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.getElementById("todoForm").requestSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeTodoForm();
    }
  });

  document.getElementById("todoTitle").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("todoForm").requestSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeTodoForm();
    }
  });

  document.getElementById("newTodoBtn").addEventListener("click", () => {
    openTodoForm();
  });
  document.getElementById("newJournalBtn").addEventListener("click", () => {
    openJournalForm();
  });
  document.getElementById("newLogBtn").addEventListener("click", () => {
    openLogForm();
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea")) return;
    const tzMenu = document.getElementById("timezoneMenu");
    if (tzMenu && !tzMenu.hidden) return;
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      openTodoForm();
    }
    if (event.key.toLowerCase() === "j") {
      event.preventDefault();
      openJournalForm();
    }
    if (event.key.toLowerCase() === "l") {
      event.preventDefault();
      openLogForm();
    }
    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      toggleTheme();
    }
  });

  const exportJournalBtn = document.getElementById("exportJournalTxt");
  const exportTodoBtn = document.getElementById("exportTodosTxtRange");
  const exportLogsBtn = document.getElementById("exportLogsTxt");
  if (exportJournalBtn) {
    exportJournalBtn.addEventListener("click", exportJournalTxt);
  }
  if (exportTodoBtn) {
    exportTodoBtn.addEventListener("click", exportTodosTxtRange);
  }
  if (exportLogsBtn) {
    exportLogsBtn.addEventListener("click", exportLogsTxt);
  }
}

function handleTodoSubmit(event) {
  event.preventDefault();
  const title = document.getElementById("todoTitle").value.trim();
  if (!title) {
    showToast("Title cannot be empty");
    document.getElementById("todoTitle").focus();
    return;
  }
  const note = document.getElementById("todoNote").value.trim();
  const id = state.editingTodoId || crypto.randomUUID();
  const todo = state.todos.find((t) => t.id === id) || {
    id,
    date: state.selectedDate,
    done: false,
    order: state.todos.filter((t) => t.date === state.selectedDate).length + 1,
  };
  todo.title = title;
  todo.note = note;
  todo.date = state.selectedDate;
  upsertTodo(todo);
  state.editingTodoId = null;
  closeTodoForm();
  renderTodos();
  renderCalendar();
  showToast("Todo saved");
}

function handleJournalSubmit(event) {
  event.preventDefault();
  const date = document.getElementById("journalDate").value;
  const time = document.getElementById("journalTime").value;
  const content = document.getElementById("journalContent").value.trim();
  if (!date || !time || !content) {
    showToast("Date, time, and content are required");
    return;
  }
  const tags = parseTags(document.getElementById("journalTags").value);
  const id = state.editingJournalId || crypto.randomUUID();
  const entry = {
    id,
    date,
    time,
    content,
    tags,
  };
  upsertJournal(entry);
  state.editingJournalId = null;
  if (state.selectedDate !== date) {
    setSelectedDate(date);
  } else {
    renderJournal();
    renderCalendar();
  }
  closeJournalForm();
  showToast("Journal entry saved");
}

function collectLogSteps() {
  const container = document.getElementById("logStepsContainer");
  if (!container) return [];
  return Array.from(container.querySelectorAll(".log-step-row")).map((row) => {
    const note = row.querySelector(".step-note")?.value.trim() || "";
    const code = row.querySelector(".step-code")?.value.trim() || "";
    const createdAt = normalizeStepCreatedAt(
      row.dataset.stepCreated,
      state.selectedDate,
      row.dataset.stepCreated
    );
    row.dataset.stepCreated = createdAt;
    refreshStepRowTimestamp(row);
    return {
      id: row.dataset.stepId || crypto.randomUUID(),
      note,
      createdAt,
      ...(code ? { code } : {}),
    };
  });
}

function handleLogSubmit(event) {
  event.preventDefault();
  const title = document.getElementById("logTitle").value.trim();
  const date = document.getElementById("logDate").value;
  if (!title) {
    showToast("Title cannot be empty");
    document.getElementById("logTitle").focus();
    return;
  }
  if (!date) {
    showToast("Date is required");
    document.getElementById("logDate").focus();
    return;
  }
  const stepsRaw = collectLogSteps();
  const steps = stepsRaw.filter((step) => step.note);
  if (!steps.length) {
    showToast("Add at least one step");
    return;
  }
  if (steps.some((step) => !step.note)) {
    showToast("Each step needs details");
    return;
  }

  const existing = state.editingLogId
    ? state.labLogs.find((item) => item.id === state.editingLogId)
    : null;
  const resultsValue = document.getElementById("logResults").value.trim();

  const log = {
    id: state.editingLogId || crypto.randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title,
    date,
    description: document.getElementById("logDescription").value.trim(),
    steps,
    ...(resultsValue ? { results: resultsValue } : {}),
  };

  upsertLog(log);
  state.editingLogId = null;
  if (state.selectedDate !== date) {
    setSelectedDate(date);
  } else {
    renderLogs();
    renderCalendar();
  }
  closeLogForm();
  showToast("Research log saved");
}

function getExportRange() {
  const fromInput = document.getElementById("exportDateFrom");
  const toInput = document.getElementById("exportDateTo");
  const fallback = state.selectedDate;
  const from = fromInput?.value || fallback;
  const to = toInput?.value || fallback;
  if (!from || !to) {
    showToast("Select a date range before exporting");
    return null;
  }
  if (from > to) {
    showToast("Date range is invalid");
    return null;
  }
  return { from, to };
}

function exportJournalTxt() {
  const range = getExportRange();
  if (!range) return;
  const { from, to } = range;
  const entries = state.journal
    .filter((entry) => entry.date >= from && entry.date <= to)
    .slice()
    .sort((a, b) => {
      if (a.date === b.date) return a.time.localeCompare(b.time);
      return a.date.localeCompare(b.date);
    });
  if (!entries.length) {
    showToast("No journal entries in the selected range");
    return;
  }
  const lines = entries.map((entry) => {
    const tags = entry.tags?.length ? ` [${entry.tags.join(", ")}]` : "";
    return `${entry.date} ${entry.time}${tags}\n${entry.content}`;
  });
  const content = [`Journal export (${from} ~ ${to})`, "", ...lines].join("\n\n");
  downloadFile(`journal_${from}_${to}.txt`, content, { mime: "text/plain;charset=utf-8", bom: true });
  showToast("Journal TXT exported");
}

function exportTodosTxtRange() {
  const range = getExportRange();
  if (!range) return;
  const { from, to } = range;
  const todos = filteredTodos()
    .filter((todo) => todo.date >= from && todo.date <= to)
    .slice()
    .sort((a, b) => {
      if (a.date === b.date) return a.order - b.order;
      return a.date.localeCompare(b.date);
    });
  if (!todos.length) {
    showToast("No todos for the current filters");
    return;
  }
  const lines = todos.map((todo) => {
    const status = todo.done ? "✔" : "○";
    const note = todo.note ? ` — ${todo.note}` : "";
    return `${todo.date} ${status} ${todo.title}${note}`;
  });
  const content = [`Todo export (${from} ~ ${to})`, "", ...lines].join("\n");
  downloadFile(`todos_${from}_${to}.txt`, content, { mime: "text/plain;charset=utf-8", bom: true });
  showToast("Todo TXT exported");
}

function exportLogsTxt() {
  const range = getExportRange();
  if (!range) return;
  const { from, to } = range;
  const logs = state.labLogs
    .filter((log) => log.date >= from && log.date <= to)
    .slice()
    .sort((a, b) => {
      if (a.date === b.date) {
        return getLogSortKey(a).localeCompare(getLogSortKey(b)) || a.title.localeCompare(b.title);
      }
      return a.date.localeCompare(b.date);
    });
  if (!logs.length) {
    showToast("No research logs in the selected range");
    return;
  }

  const blocks = logs.map((log) => {
    const lines = [`${log.date} — ${log.title}`];
    if (log.description) lines.push(`Description: ${log.description}`);
    if (log.results) lines.push(`Results: ${log.results}`);
    if (log.steps?.length) {
      lines.push("Operations:");
      log.steps.forEach((step) => {
        const stamp = step.createdAt ? formatStepTimestamp(step.createdAt) : "";
        const prefix = stamp ? `[${stamp}] ` : "";
        lines.push(`  - ${prefix}${step.note}`);
        if (step.code) {
          lines.push(`      Code/URL: ${step.code}`);
        }
      });
    }
    return lines.join("\n");
  });

  const content = [`Research log export (${from} ~ ${to})`, "", ...blocks].join("\n\n");
  downloadFile(`research_logs_${from}_${to}.txt`, content, { mime: "text/plain;charset=utf-8", bom: true });
  showToast("Research log TXT exported");
}

function downloadFile(filename, content, options = {}) {
  const { mime = "text/plain;charset=utf-8", bom = false } = options;
  const data = bom && mime.startsWith("text/") ? `\ufeff${content}` : content;
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

let dragSourceId = null;
function handleDragStart(event) {
  dragSourceId = event.currentTarget.dataset.id;
  event.currentTarget.classList.add("dragging");
}

function handleDragOver(event) {
  event.preventDefault();
  const target = event.currentTarget;
  if (!target.classList.contains("todo-item")) return;
  const list = target.parentElement;
  const dragging = list.querySelector(".dragging");
  if (!dragging || dragging === target) return;
  const draggingIndex = Array.from(list.children).indexOf(dragging);
  const targetIndex = Array.from(list.children).indexOf(target);
  if (draggingIndex < targetIndex) {
    list.insertBefore(target, dragging);
  } else {
    list.insertBefore(dragging, target);
  }
}

function handleDrop(event) {
  event.preventDefault();
  const targetId = event.currentTarget.dataset.id;
  if (!dragSourceId || dragSourceId === targetId) return;
  const todos = state.todos.filter((t) => t.date === state.selectedDate).sort((a, b) => a.order - b.order);
  const dragged = todos.find((t) => t.id === dragSourceId);
  const target = todos.find((t) => t.id === targetId);
  if (!dragged || !target) return;
  const draggedOrder = dragged.order;
  dragged.order = target.order;
  if (draggedOrder < target.order) {
    todos.forEach((t) => {
      if (t.id !== dragged.id && t.order <= target.order && t.order > draggedOrder) {
        t.order -= 1;
      }
    });
  } else {
    todos.forEach((t) => {
      if (t.id !== dragged.id && t.order >= target.order && t.order < draggedOrder) {
        t.order += 1;
      }
    });
  }
  persist(STORAGE_KEYS.todos, state.todos);
  normalizeOrders(state.selectedDate);
  renderTodos();
  renderCalendar();
}

function handleDragEnd(event) {
  event.currentTarget.classList.remove("dragging");
  dragSourceId = null;
}

function initialize() {
  loadState();
  setupTheme();
  setupTimezonePicker();
  setupEventHandlers();
  const now = nowInTimeZone();
  document.getElementById("journalDate").value = state.selectedDate || now.date;
  document.getElementById("journalTime").value = now.time;
  const logDateInput = document.getElementById("logDate");
  if (logDateInput) {
    logDateInput.value = state.selectedDate || now.date;
  }
  resetLogSteps([{ createdAt: new Date().toISOString() }]);
  refreshAutosizeWithin(document);
  document.getElementById("selectedDateLabel").textContent = formatter.label(state.selectedDate);
  const exportFrom = document.getElementById("exportDateFrom");
  const exportTo = document.getElementById("exportDateTo");
  if (exportFrom) exportFrom.value = state.selectedDate;
  if (exportTo) exportTo.value = state.selectedDate;
  renderCalendar();
  renderTodos();
  renderJournal();
  renderLogs();
}

window.addEventListener("DOMContentLoaded", initialize);

// Self-check: data persists after refresh; TXT export preserves order; calendar selection stays in sync; filters respond immediately; keyboard shortcuts and focus work; drag/drop or button sorting saves instantly.
