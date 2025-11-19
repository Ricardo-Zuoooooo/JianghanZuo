const STORAGE_KEYS = {
  journal: "dm_journal",
  todos: "dm_todos",
  settings: "dm_settings",
  logs: "dm_labLogs",
  ratings: "dm_dayRatings",
  ledger: "dm_ledger",
  ledgerHistory: "dm_ledgerHistory",
  workspace: "dm_workspace",
};

const TIMEZONE_OPTIONS = [
  { value: "Europe/London", label: "Europe/London" },
  { value: "Asia/Shanghai", label: "China" },
];

const DAY_RATING_PICKERS = [
  { field: "workTime", buttonId: "dayWorkTime", menuId: "dayWorkTimeMenu", label: "Working time", min: 0, max: 10, allowNull: true },
  { field: "trainingTime", buttonId: "dayTrainingTime", menuId: "dayTrainingTimeMenu", label: "Training time", min: 0, max: 10, allowNull: true },
];

const LEDGER_FIELDS = [
  { key: "alipay", label: "Alipay" },
  { key: "wechat", label: "WeChat" },
  { key: "bankCn", label: "Bank Account (cn)" },
  { key: "debt", label: "Debt" },
  { key: "bankUk", label: "Bank Account (uk)" },
];

const LEDGER_TOTAL_KEYS = ["alipay", "wechat", "bankCn"];

const DEFAULT_LEDGER = LEDGER_FIELDS.reduce((acc, field) => {
  acc[field.key] = "";
  return acc;
}, {});

const DEFAULT_WORKSPACE = {
  project: "",
  fitness: "",
  money: "",
};

const MS_PER_DAY = 86_400_000;

const DEFAULT_SETTINGS = {
  theme: "light",
  timeZone: TIMEZONE_OPTIONS[0].value,
};

const state = {
  journal: [],
  todos: [],
  labLogs: [],
  dayRatings: [],
  ledger: { ...DEFAULT_LEDGER },
  ledgerHistory: {},
  workspace: { ...DEFAULT_WORKSPACE },
  settings: { ...DEFAULT_SETTINGS },
  selectedDate: null,
  calendarAnchor: null,
  editingTodoId: null,
  editingJournalId: null,
  editingLogId: null,
};

const AUTOSIZE_MAX_HEIGHT = 280;

const ratingPickerRegistry = new Map();
let openRatingPickerField = null;
let ratingPickerDocumentBound = false;

function normalizeRatingValue(value, { allowNull = false } = {}) {
  if (value == null) {
    return allowNull ? null : "";
  }
  const trimmed = typeof value === "string" ? value.trim() : String(value).trim();
  if (trimmed === "") {
    return allowNull ? null : "";
  }
  const numeric = Number(trimmed);
  if (!Number.isFinite(numeric)) {
    return allowNull ? null : "";
  }
  const clamped = Math.max(0, Math.min(10, Math.round(numeric)));
  return allowNull ? clamped : String(clamped);
}

function normalizeDayRating(entry) {
  if (!entry || !entry.date) return null;
  const base = { ...entry };
  const workTime = normalizeRatingValue(base.workTime);
  const trainingTime = normalizeRatingValue(base.trainingTime);
  const commitSource =
    base.commit ?? base.note ?? base.summary ?? base.notes ?? base.commitNote ?? base.commitText ?? "";
  const commit = String(commitSource).replace(/\s+$/u, "");
  return { date: base.date, workTime, trainingTime, commit };
}

function normalizeLedger(raw) {
  const base = { ...DEFAULT_LEDGER };
  if (raw && typeof raw === "object") {
    LEDGER_FIELDS.forEach(({ key }) => {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        const value = raw[key];
        base[key] = value == null ? "" : String(value);
      }
    });

    if (Object.prototype.hasOwnProperty.call(raw, "bankUkDebt")) {
      const legacyDebt = raw.bankUkDebt == null ? "" : String(raw.bankUkDebt);
      if (!base.debt && legacyDebt) {
        base.debt = legacyDebt;
      }
    }
  }
  return base;
}

function normalizeWorkspace(raw) {
  const base = { ...DEFAULT_WORKSPACE };
  if (raw && typeof raw === "object") {
    ["project", "fitness", "money"].forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        base[key] = raw[key] == null ? "" : String(raw[key]);
      }
    });
  }
  return base;
}

function normalizeLedgerHistory(raw) {
  const history = {};
  if (!raw || typeof raw !== "object") {
    return history;
  }
  Object.entries(raw).forEach(([date, entries]) => {
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return;
    }
    if (!Array.isArray(entries)) {
      return;
    }
    const normalizedEntries = entries
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const field = LEDGER_FIELDS.find((item) => item.key === entry.field)?.key;
        if (!field) return null;
        const baseDirection = entry.direction === "subtract" ? "subtract" : "add";
        const numericSource =
          typeof entry.delta === "number"
            ? entry.delta
            : typeof entry.amount === "number"
            ? entry.amount * (baseDirection === "add" ? 1 : -1)
            : typeof entry.value === "number"
            ? entry.value
            : Number(entry.delta);
        const rounded = Number.isFinite(numericSource) ? roundLedgerAmount(numericSource) : 0;
        if (rounded === 0) return null;
        const direction = rounded < 0 ? "subtract" : rounded > 0 ? "add" : baseDirection;
        const delta = direction === "subtract" ? -Math.abs(rounded) : Math.abs(rounded);
        const createdAt =
          typeof entry.createdAt === "string" && !Number.isNaN(new Date(entry.createdAt).getTime())
            ? entry.createdAt
            : new Date().toISOString();
        const id = typeof entry.id === "string" && entry.id ? entry.id : crypto.randomUUID();
        return {
          id,
          date,
          field,
          direction,
          delta,
          createdAt,
        };
      })
      .filter(Boolean)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    if (normalizedEntries.length) {
      history[date] = normalizedEntries;
    }
  });
  return history;
}

function ledgerValueToNumber(value) {
  if (value == null) return 0;
  const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : String(value).trim();
  if (!normalized) return 0;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getLedgerFieldLabel(key) {
  const field = LEDGER_FIELDS.find((item) => item.key === key);
  return field ? field.label : key;
}

function updateLedgerInputVisual(input) {
  if (!input) return;
  const hasValue = input.value.trim().length > 0;
  input.dataset.hasValue = hasValue ? "true" : "false";
}

function roundLedgerAmount(value) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Number.isFinite(rounded) ? rounded : 0;
}

const ledgerNumberFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatLedgerTotal(value) {
  if (!Number.isFinite(value)) return "0";
  return ledgerNumberFormatter.format(value);
}

function toUtcMidnight(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null;
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  return Date.UTC(year, month - 1, day);
}

function getDayDifference(targetDate, baseDate) {
  const targetUtc = toUtcMidnight(targetDate);
  const baseUtc = toUtcMidnight(baseDate);
  if (targetUtc == null || baseUtc == null) return null;
  return Math.round((targetUtc - baseUtc) / MS_PER_DAY);
}

function isDayRatingEmpty(entry) {
  if (!entry) return true;
  const hasWork = typeof entry.workTime === "string" && entry.workTime.trim() !== "";
  const hasTraining = typeof entry.trainingTime === "string" && entry.trainingTime.trim() !== "";
  const hasCommit = typeof entry.commit === "string" && entry.commit.trim() !== "";
  return !hasWork && !hasTraining && !hasCommit;
}

function normalizeLog(log) {
  const nextLog = { ...log };
  const createdSource =
    log?.createdAt ||
    log?.created_at ||
    log?.updatedAt ||
    (log?.steps || []).find((step) => step.time)?.time ||
    (log?.date ? `${log.date}T00:00:00.000Z` : null);
  const inferredCreated = normalizeStepCreatedAt(
    createdSource,
    log?.date || null,
    typeof createdSource === "string" && createdSource.includes("T") ? createdSource : null
  );
  nextLog.createdAt = inferredCreated || new Date().toISOString();
  const normalizedUpdated = normalizeStepCreatedAt(log?.updatedAt, null, nextLog.createdAt);
  nextLog.updatedAt = normalizedUpdated || nextLog.createdAt;

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
  delete nextLog.date;

  const baseDate = nextLog.createdAt?.slice(0, 10) || log?.date || new Date().toISOString().slice(0, 10);

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
      let extractedCode = "";

      if (note.includes("Code/URL:")) {
        const [notePart, ...codeParts] = note.split("Code/URL:");
        note = notePart.replace(/•\s*$/, "").trim();
        extractedCode = codeParts.join("Code/URL:").trim();
      }

      if (note.startsWith("Time ")) {
        const [, ...rest] = note.split("•");
        const cleaned = rest.join("•").trim();
        if (cleaned) {
          note = cleaned;
        }
      }

      const initialSource =
        typeof step?.code === "string"
          ? step.code
          : typeof step?.codes === "string"
          ? step.codes
          : typeof step?.url === "string"
          ? step.url
          : typeof step?.urls === "string"
          ? step.urls
          : typeof step?.resources === "string"
          ? step.resources
          : "";
      const initialCode = initialSource.trim();

      if (!note && !initialCode && !extractedCode) return null;
      if (!note && extractedCode) {
        note = extractedCode;
        extractedCode = "";
      } else if (!note && initialCode) {
        note = initialCode;
      }

      const createdAt = normalizeStepCreatedAt(
        step?.createdAt || step?.timestamp || step?.timeStamp || step?.time || step?.addedAt,
        baseDate,
        step?.createdAt || nextLog.createdAt
      );

      const normalized = { id, note, createdAt };

      const normalizedSequence = Array.isArray(step?.sequence)
        ? step.sequence
            .map((entry) => {
              if (!entry) return null;
              const type = entry.type === "code" ? "code" : "commit";
              const value = (entry.value == null ? "" : String(entry.value)).trim();
              if (!value || value === note) return null;
              return { type, value };
            })
            .filter(Boolean)
        : null;

      let commits = [];
      let codes = [];

      if (normalizedSequence?.length) {
        normalized.sequence = normalizedSequence;
        commits = normalizedSequence
          .filter((entry) => entry.type === "commit")
          .map((entry) => entry.value);
        codes = normalizedSequence
          .filter((entry) => entry.type === "code")
          .map((entry) => entry.value);
      } else {
        const commitSources = [];
        if (Array.isArray(step?.commits)) commitSources.push(...step.commits);
        if (Array.isArray(step?.extraCommits)) commitSources.push(...step.extraCommits);
        if (Array.isArray(step?.additionalCommits)) commitSources.push(...step.additionalCommits);
        if (Array.isArray(step?.notes)) commitSources.push(...step.notes);

        commits = commitSources
          .map((entry) => (entry == null ? "" : String(entry)).trim())
          .filter((entry) => entry && entry !== note);

        const codeSources = [];
        if (Array.isArray(step?.codes)) codeSources.push(...step.codes);
        if (Array.isArray(step?.codeSnippets)) codeSources.push(...step.codeSnippets);
        if (Array.isArray(step?.codeNotes)) codeSources.push(...step.codeNotes);
        if (Array.isArray(step?.codeUrls)) codeSources.push(...step.codeUrls);
        if (Array.isArray(step?.resources)) codeSources.push(...step.resources);
        if (typeof step?.code === "string") codeSources.push(step.code);
        if (extractedCode) codeSources.unshift(extractedCode);

        codes = codeSources
          .map((entry) => (entry == null ? "" : String(entry)).trim())
          .filter((entry) => entry);

        if (initialCode && !codes.length && initialCode !== note) {
          codes.push(initialCode);
        }
      }

      if (commits.length) {
        normalized.commits = commits;
      }
      if (codes.length) {
        normalized.codes = codes;
      }
      if (!normalized.sequence && (commits.length || codes.length)) {
        normalized.sequence = [
          ...commits.map((value) => ({ type: "commit", value })),
          ...codes.map((value) => ({ type: "code", value })),
        ];
      }
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

function getDayRating(date) {
  if (!date) return null;
  return state.dayRatings.find((entry) => entry.date === date) || null;
}

function setDayRating(date, updates = {}) {
  if (!date) return false;
  const existing = getDayRating(date) || { date };
  const normalized = normalizeDayRating({ ...existing, ...updates, date });
  if (!normalized) return false;
  const index = state.dayRatings.findIndex((entry) => entry.date === date);
  if (isDayRatingEmpty(normalized)) {
    if (index !== -1) {
      state.dayRatings.splice(index, 1);
      persist(STORAGE_KEYS.ratings, state.dayRatings);
      return true;
    }
    return false;
  }
  if (index === -1) {
    state.dayRatings.push(normalized);
    persist(STORAGE_KEYS.ratings, state.dayRatings);
    return true;
  }
  const prev = state.dayRatings[index];
  const unchanged =
    prev &&
    prev.workTime === normalized.workTime &&
    prev.trainingTime === normalized.trainingTime &&
    prev.commit === normalized.commit;
  if (unchanged) {
    return false;
  }
  state.dayRatings[index] = normalized;
  persist(STORAGE_KEYS.ratings, state.dayRatings);
  return true;
}

function updateRatingPickerDisplay(field, rawValue) {
  const entry = ratingPickerRegistry.get(field);
  if (!entry || !entry.button || !entry.menu) return;
  const { button, menu, config } = entry;
  const value = rawValue == null ? "" : String(rawValue);
  const hasValue = value !== "";
  button.textContent = hasValue ? value : "--";
  button.dataset.value = value;
  button.dataset.hasValue = hasValue ? "true" : "false";
  const label = hasValue ? `${config.label}: ${value}` : `${config.label}: not set`;
  button.setAttribute("aria-label", label);
  const options = menu.querySelectorAll("[data-value]");
  options.forEach((item) => {
    const optionValue = item.dataset.value ?? "";
    const isActive = optionValue === value;
    item.setAttribute("aria-selected", String(isActive));
    item.classList.toggle("active", isActive);
  });
}

function closeRatingPicker(field) {
  if (!field) return;
  const entry = ratingPickerRegistry.get(field);
  if (!entry || !entry.menu || !entry.button) return;
  entry.menu.hidden = true;
  entry.button.setAttribute("aria-expanded", "false");
  if (openRatingPickerField === field) {
    openRatingPickerField = null;
  }
}

function closeAllRatingPickers() {
  ratingPickerRegistry.forEach((_, field) => {
    closeRatingPicker(field);
  });
}

function openRatingPicker(field) {
  const entry = ratingPickerRegistry.get(field);
  if (!entry || !entry.menu || !entry.button) return;
  if (openRatingPickerField && openRatingPickerField !== field) {
    closeRatingPicker(openRatingPickerField);
  }
  entry.menu.hidden = false;
  entry.button.setAttribute("aria-expanded", "true");
  openRatingPickerField = field;
  const currentValue = entry.button.dataset.value ?? "";
  updateRatingPickerDisplay(field, currentValue === "" ? null : currentValue);
  const selector = `[data-value="${safeCssEscape(currentValue)}"]`;
  const active = entry.menu.querySelector(selector) || entry.menu.querySelector("[data-value]");
  requestAnimationFrame(() => active?.focus());
}

function renderDayRating() {
  const data = getDayRating(state.selectedDate);
  updateRatingPickerDisplay("workTime", data?.workTime ?? "");
  updateRatingPickerDisplay("trainingTime", data?.trainingTime ?? "");
  const commitField = document.getElementById("dayCommitNotes");
  if (commitField) {
    commitField.value = data?.commit || "";
    autoResize(commitField);
  }
  closeAllRatingPickers();
}

function handleDayRatingSelection(field, rawValue) {
  if (!state.selectedDate) return;
  const updates = {};
  if (field === "workTime") {
    updates.workTime = rawValue ?? "";
  } else if (field === "trainingTime") {
    updates.trainingTime = rawValue ?? "";
  } else {
    return;
  }
  const changed = setDayRating(state.selectedDate, updates);
  renderDayRating();
  if (changed) {
    renderCalendar();
  }
  closeRatingPicker(field);
  const button = ratingPickerRegistry.get(field)?.button;
  button?.focus();
}

function handleDayRatingCommitInput() {
  if (!state.selectedDate) return;
  const commitField = document.getElementById("dayCommitNotes");
  if (!commitField) return;
  const changed = setDayRating(state.selectedDate, { commit: commitField.value });
  if (changed) {
    renderCalendar();
  }
}

function ensureRatingMenuOptions(menu, config) {
  if (!menu || !config) return;
  menu.innerHTML = "";
  const options = [];
  if (config.allowNull) {
    options.push({ value: "", label: "--" });
  }
  for (let value = config.min; value <= config.max; value += 1) {
    options.push({ value: String(value), label: String(value) });
  }
  options.forEach(({ value, label }) => {
    const item = document.createElement("li");
    item.textContent = label;
    item.dataset.value = value;
    item.setAttribute("role", "option");
    item.setAttribute("tabindex", "0");
    item.addEventListener("click", () => {
      handleDayRatingSelection(config.field, value);
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        handleDayRatingSelection(config.field, value);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeRatingPicker(config.field);
        const button = ratingPickerRegistry.get(config.field)?.button;
        button?.focus();
      }
    });
    menu.appendChild(item);
  });
}

function setupDayRatingPickers() {
  DAY_RATING_PICKERS.forEach((config) => {
    const button = document.getElementById(config.buttonId);
    const menu = document.getElementById(config.menuId);
    if (!button || !menu) return;
    const control = button.closest(".rating-control") || button.parentElement;
    menu.hidden = true;
    menu.dataset.field = config.field;
    button.dataset.value = button.dataset.value ?? "";
    button.dataset.hasValue = button.dataset.hasValue ?? "false";
    ensureRatingMenuOptions(menu, config);
    ratingPickerRegistry.set(config.field, { button, menu, control, config });
    button.addEventListener("click", () => {
      if (menu.hidden) {
        openRatingPicker(config.field);
      } else {
        closeRatingPicker(config.field);
      }
    });
    button.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && menu.hidden) {
        event.preventDefault();
        openRatingPicker(config.field);
      }
      if (event.key === "ArrowDown" && menu.hidden) {
        event.preventDefault();
        openRatingPicker(config.field);
      }
      if (event.key === "Escape" && !menu.hidden) {
        event.preventDefault();
        closeRatingPicker(config.field);
      }
    });
    updateRatingPickerDisplay(config.field, null);
  });
  if (!ratingPickerDocumentBound) {
    document.addEventListener("click", (event) => {
      if (!openRatingPickerField) return;
      const entry = ratingPickerRegistry.get(openRatingPickerField);
      if (!entry || !entry.control) return;
      if (!entry.control.contains(event.target)) {
        closeAllRatingPickers();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && openRatingPickerField) {
        event.preventDefault();
        const field = openRatingPickerField;
        closeRatingPicker(field);
        const button = ratingPickerRegistry.get(field)?.button;
        button?.focus();
      }
    });
    ratingPickerDocumentBound = true;
  }
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

function renderWorkspaceSidebar() {
  const data = state.workspace || DEFAULT_WORKSPACE;
  const fields = document.querySelectorAll("[data-sidebar-field]");
  fields.forEach((field) => {
    const key = field.dataset.sidebarField;
    if (!key) return;
    const value = data[key] ?? "";
    if (field.value !== value) {
      field.value = value;
      autoResize(field);
    }
  });
}

function updateWorkspaceField(key, value) {
  if (!key) return;
  const next = normalizeWorkspace({ ...state.workspace, [key]: value });
  state.workspace = next;
  persist(STORAGE_KEYS.workspace, state.workspace);
}

function setSidebarOpen(open) {
  const sidebar = document.getElementById("workspaceSidebar");
  const toggle = document.getElementById("sidebarToggle");
  const scrim = document.getElementById("sidebarScrim");
  const closeBtn = document.getElementById("sidebarClose");
  if (!sidebar || !toggle) return;
  sidebar.classList.toggle("collapsed", !open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.setAttribute("aria-label", open ? "Collapse workspace sidebar" : "Expand workspace sidebar");
  toggle.classList.toggle("hidden-toggle", open);
  if (closeBtn) closeBtn.setAttribute("aria-expanded", open ? "true" : "false");
  if (scrim) {
    scrim.hidden = !open;
    scrim.classList.toggle("visible", open);
  }
}

function toggleSidebar(force) {
  const sidebar = document.getElementById("workspaceSidebar");
  const shouldOpen = typeof force === "boolean" ? force : sidebar?.classList.contains("collapsed");
  setSidebarOpen(shouldOpen);
}

function setupWorkspaceSidebar() {
  const sidebar = document.getElementById("workspaceSidebar");
  const toggle = document.getElementById("sidebarToggle");
  const closeBtn = document.getElementById("sidebarClose");
  const scrim = document.getElementById("sidebarScrim");
  if (!sidebar || !toggle) return;
  toggle.addEventListener("click", () => toggleSidebar());
  closeBtn?.addEventListener("click", () => toggleSidebar(false));
  scrim?.addEventListener("click", () => toggleSidebar(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sidebar.classList.contains("collapsed")) {
      toggleSidebar(false);
      toggle.focus();
    }
  });
  sidebar.querySelectorAll("[data-sidebar-field]").forEach((field) => {
    field.addEventListener("input", (event) => {
      autoResize(event.target);
      updateWorkspaceField(event.target.dataset.sidebarField, event.target.value);
    });
  });
  renderWorkspaceSidebar();
  refreshAutosizeWithin(sidebar);
  toggleSidebar(false);
}

function confirmRemovalIfFilled(inputs, message) {
  let list = [];
  if (!inputs) {
    list = [];
  } else if (Array.isArray(inputs)) {
    list = inputs;
  } else if (typeof inputs.length === "number" && typeof inputs.item === "function") {
    list = Array.from(inputs);
  } else {
    list = [inputs];
  }
  const hasContent = list.some((input) => {
    if (!input) return false;
    const value = typeof input.value === "string" ? input.value : input.textContent;
    return Boolean(value && value.trim());
  });
  if (!hasContent) return true;
  return window.confirm(message || "This will remove content. Continue?");
}

function getDragAfterElement(container, y) {
  const items = Array.from(container.querySelectorAll(".step-field.reorderable:not(.dragging)"));
  return items
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return { element, offset: y - (rect.top + rect.height / 2) };
    })
    .filter(({ offset }) => offset < 0)
    .reduce(
      (closest, current) => (current.offset > closest.offset ? current : closest),
      { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
}

function setupStepFieldReorder(container) {
  if (!container || container.dataset.reorderBound) return;
  container.dataset.reorderBound = "true";
  container.addEventListener("dragover", (event) => {
    const dragging = container.querySelector(".step-field.dragging");
    if (!dragging) return;
    event.preventDefault();
    const afterElement = getDragAfterElement(container, event.clientY);
    if (!afterElement) {
      container.appendChild(dragging);
    } else {
      container.insertBefore(dragging, afterElement);
    }
  });
  container.addEventListener("drop", (event) => {
    const dragging = container.querySelector(".step-field.dragging");
    if (!dragging) return;
    event.preventDefault();
    dragging.classList.remove("dragging");
  });
}

function makeFieldReorderable(wrapper) {
  if (!wrapper || wrapper.dataset.reorderBound) return;
  wrapper.dataset.reorderBound = "true";
  wrapper.classList.add("reorderable");
  wrapper.setAttribute("draggable", "true");
  wrapper.addEventListener("dragstart", (event) => {
    wrapper.classList.add("dragging");
    event.dataTransfer.effectAllowed = "move";
    try {
      event.dataTransfer.setData("text/plain", "");
    } catch (error) {
      /* no-op */
    }
  });
  wrapper.addEventListener("dragend", () => {
    wrapper.classList.remove("dragging");
  });
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
    const ratingsRaw = localStorage.getItem(STORAGE_KEYS.ratings);
    const ledgerRaw = localStorage.getItem(STORAGE_KEYS.ledger);
    const ledgerHistoryRaw = localStorage.getItem(STORAGE_KEYS.ledgerHistory);
    const workspaceRaw = localStorage.getItem(STORAGE_KEYS.workspace);
    if (journalRaw) state.journal = JSON.parse(journalRaw);
    if (todosRaw) state.todos = JSON.parse(todosRaw);
    if (settingsRaw) state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRaw) };
    if (logsRaw) state.labLogs = JSON.parse(logsRaw);
    if (ratingsRaw) state.dayRatings = JSON.parse(ratingsRaw);
    if (ledgerRaw) state.ledger = JSON.parse(ledgerRaw);
    if (ledgerHistoryRaw) state.ledgerHistory = JSON.parse(ledgerHistoryRaw);
    if (workspaceRaw) state.workspace = JSON.parse(workspaceRaw);
  } catch (error) {
    console.error("Failed to load local state", error);
  }
  if (!Array.isArray(state.labLogs)) {
    state.labLogs = [];
  }
  state.labLogs = state.labLogs.map((log) => normalizeLog(log));
  if (!Array.isArray(state.dayRatings)) {
    state.dayRatings = [];
  }
  state.dayRatings = state.dayRatings
    .map((entry) => normalizeDayRating(entry))
    .filter((entry) => entry && !isDayRatingEmpty(entry));
  state.ledger = normalizeLedger(state.ledger);
  state.ledgerHistory = normalizeLedgerHistory(state.ledgerHistory);
  state.workspace = normalizeWorkspace(state.workspace);
  if (!TIMEZONE_OPTIONS.some((opt) => opt.value === state.settings.timeZone)) {
    state.settings.timeZone = DEFAULT_SETTINGS.timeZone;
  }
  if (Object.prototype.hasOwnProperty.call(state.settings, "selectedDate")) {
    delete state.settings.selectedDate;
  }
  const current = nowInTimeZone();
  const today = current?.date || new Date().toISOString().slice(0, 10);
  state.selectedDate = today;
  state.calendarAnchor = state.selectedDate;
}

function persist(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function saveAll() {
  persist(STORAGE_KEYS.journal, state.journal);
  persist(STORAGE_KEYS.todos, state.todos);
  persist(STORAGE_KEYS.logs, state.labLogs);
  persist(STORAGE_KEYS.ratings, state.dayRatings);
  persist(STORAGE_KEYS.ledger, state.ledger);
  persist(STORAGE_KEYS.ledgerHistory, state.ledgerHistory);
  persist(STORAGE_KEYS.workspace, state.workspace);
}

function saveSettings() {
  persist(STORAGE_KEYS.settings, {
    theme: document.body.dataset.theme || "light",
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
  const journalForm = document.getElementById("journalForm");
  if (journalForm && journalForm.hidden) {
    const now = nowInTimeZone();
    const journalDate = document.getElementById("journalDate");
    const journalTime = document.getElementById("journalTime");
    if (journalDate) journalDate.value = state.selectedDate || now.date;
    if (journalTime) journalTime.value = now.time;
  }
  renderDayRating();
  renderCalendar();
  renderTodos();
  renderJournal();
  renderLogs();
  renderLedgerHistory();
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
  state.calendarAnchor = date;
  document.getElementById("selectedDateLabel").textContent = formatter.label(date);
  const journalDate = document.getElementById("journalDate");
  if (journalDate) {
    journalDate.value = date;
  }
  closeTodoForm();
  closeJournalForm();
  closeLogForm();
  const exportFrom = document.getElementById("exportDateFrom");
  const exportTo = document.getElementById("exportDateTo");
  if (exportFrom && !exportFrom.value) exportFrom.value = date;
  if (exportTo && !exportTo.value) exportTo.value = date;
  renderDayRating();
  renderTodos();
  renderJournal();
  renderLogs();
  renderCalendar();
  renderLedgerHistory();
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
  if (!form) return;
  form.hidden = false;
  const now = nowInTimeZone();
  const date = state.selectedDate || now.date;
  const contentField = document.getElementById("journalContent");
  if (!contentField) return;
  if (entry) {
    state.editingJournalId = entry.id;
    const journalDate = document.getElementById("journalDate");
    const journalTime = document.getElementById("journalTime");
    const journalTags = document.getElementById("journalTags");
    if (journalDate) journalDate.value = entry.date;
    if (journalTime) journalTime.value = entry.time;
    if (journalTags) journalTags.value = entry.tags?.join(", ") || "";
    contentField.value = entry.content;
  } else {
    state.editingJournalId = null;
    form.reset();
    const journalDate = document.getElementById("journalDate");
    const journalTime = document.getElementById("journalTime");
    if (journalDate) journalDate.value = date;
    if (journalTime) journalTime.value = now.time;
    contentField.value = "";
  }
  setupAutoResize(contentField);
  contentField.focus();
}

function closeJournalForm() {
  const form = document.getElementById("journalForm");
  if (!form) return;
  form.reset();
  const now = nowInTimeZone();
  const journalDate = document.getElementById("journalDate");
  const journalTime = document.getElementById("journalTime");
  if (journalDate) journalDate.value = state.selectedDate || now.date;
  if (journalTime) journalTime.value = now.time;
  state.editingJournalId = null;
  const contentField = document.getElementById("journalContent");
  if (contentField) {
    contentField.value = "";
    setupAutoResize(contentField);
  }
  form.hidden = true;
}

function addLogStepRow(step = {}) {
  const container = document.getElementById("logStepsContainer");
  if (!container) return null;
  const row = document.createElement("div");
  row.className = "log-step-row";
  row.dataset.stepId = step.id || crypto.randomUUID();
  const fallbackIso = step?.createdAt || step?.timestamp || step?.timeStamp || step?.time || step?.addedAt || null;
  const baseDate = typeof fallbackIso === "string" && fallbackIso.includes("T") ? fallbackIso.slice(0, 10) : null;
  const createdAt = normalizeStepCreatedAt(
    fallbackIso,
    baseDate,
    typeof fallbackIso === "string" && fallbackIso.includes("T") ? fallbackIso : null
  );
  row.dataset.stepCreated = createdAt;

  const actions = document.createElement("div");
  actions.className = "step-actions";

  const timestamp = document.createElement("span");
  timestamp.className = "step-timestamp";
  timestamp.textContent = formatStepTimestamp(createdAt);
  actions.appendChild(timestamp);

  const actionButtons = document.createElement("div");
  actionButtons.className = "step-action-buttons";
  actions.appendChild(actionButtons);

  const fields = document.createElement("div");
  fields.className = "step-fields";
  setupStepFieldReorder(fields);

  const createCommitField = (value = "", { primary = false } = {}) => {
    const wrapper = document.createElement("div");
    wrapper.className = `step-field${primary ? " primary" : ""}`;
    const textarea = document.createElement("textarea");
    textarea.className = `${primary ? "step-note" : "step-commit-extra"} auto-resize`;
    textarea.rows = 1;
    textarea.placeholder = primary ? "Commit or change" : "Additional commit";
    textarea.value = value || "";
    wrapper.appendChild(textarea);
    if (primary) {
      textarea.required = true;
    } else {
      wrapper.dataset.extraType = "commit";
      const removeExtra = document.createElement("button");
      removeExtra.type = "button";
      removeExtra.className = "remove-sub-field";
      removeExtra.title = "Remove commit";
      removeExtra.setAttribute("aria-label", "Remove commit");
      removeExtra.textContent = "✕";
      removeExtra.addEventListener("click", () => {
        if (!confirmRemovalIfFilled(textarea, "Remove this commit?")) return;
        wrapper.remove();
      });
      wrapper.appendChild(removeExtra);
    }
    return { wrapper, textarea };
  };

  const createCodeField = (value = "") => {
    const wrapper = document.createElement("div");
    wrapper.className = "step-field";
    wrapper.dataset.extraType = "code";
    const textarea = document.createElement("textarea");
    textarea.className = "step-code auto-resize";
    textarea.rows = 1;
    textarea.placeholder = "Code notes or URLs";
    textarea.value = value || "";
    wrapper.appendChild(textarea);
    const removeExtra = document.createElement("button");
    removeExtra.type = "button";
    removeExtra.className = "remove-sub-field";
    removeExtra.title = "Remove code note or URL";
    removeExtra.setAttribute("aria-label", "Remove code note or URL");
    removeExtra.textContent = "✕";
    removeExtra.addEventListener("click", () => {
      if (!confirmRemovalIfFilled(textarea, "Remove this code note or URL?")) return;
      wrapper.remove();
    });
    wrapper.appendChild(removeExtra);
    return { wrapper, textarea };
  };

  const appendCommitField = (value = "", options = {}) => {
    const { wrapper, textarea } = createCommitField(value, options);
    fields.appendChild(wrapper);
    setupAutoResize(textarea);
    if (!options.primary) {
      makeFieldReorderable(wrapper);
    }
    return textarea;
  };

  const appendCodeField = (value = "") => {
    const { wrapper, textarea } = createCodeField(value);
    fields.appendChild(wrapper);
    setupAutoResize(textarea);
    makeFieldReorderable(wrapper);
    return textarea;
  };

  const addCommitBtn = document.createElement("button");
  addCommitBtn.type = "button";
  addCommitBtn.className = "step-action-btn";
  addCommitBtn.textContent = "+Commit";
  addCommitBtn.addEventListener("click", () => {
    const textarea = appendCommitField("", { primary: false });
    textarea.focus();
  });
  actionButtons.appendChild(addCommitBtn);

  const addCodeBtn = document.createElement("button");
  addCodeBtn.type = "button";
  addCodeBtn.className = "step-action-btn";
  addCodeBtn.textContent = "+Code or URLs";
  addCodeBtn.addEventListener("click", () => {
    const textarea = appendCodeField("");
    textarea.focus();
  });
  actionButtons.appendChild(addCodeBtn);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "remove-step";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => {
    const textareas = row.querySelectorAll("textarea");
    if (!confirmRemovalIfFilled(textareas, "Remove this step?")) return;
    row.remove();
    if (!container.querySelector(".log-step-row")) {
      addLogStepRow();
    }
  });
  actionButtons.appendChild(removeBtn);

  row.appendChild(actions);
  row.appendChild(fields);

  container.appendChild(row);

  const noteArea = appendCommitField(step.note || "", { primary: true });
  const extras = Array.isArray(step?.sequence) ? step.sequence : null;
  if (extras?.length) {
    extras.forEach((entry) => {
      const value = entry?.value == null ? "" : String(entry.value).trim();
      if (!value) return;
      if (entry.type === "code") {
        appendCodeField(value);
      } else {
        appendCommitField(value, { primary: false });
      }
    });
  } else {
    const commitExtras = Array.isArray(step?.commits) ? step.commits : [];
    commitExtras
      .map((value) => (value == null ? "" : String(value)).trim())
      .filter((value) => value)
      .forEach((value) => appendCommitField(value, { primary: false }));

    const codeValues = [];
    if (Array.isArray(step?.codes)) codeValues.push(...step.codes);
    if (typeof step?.code === "string") codeValues.push(step.code);
    codeValues
      .map((value) => (value == null ? "" : String(value)).trim())
      .filter((value) => value)
      .forEach((value) => appendCodeField(value));
  }

  setupAutoResize(noteArea);
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
  state.editingLogId = log ? log.id : null;
  document.getElementById("logTitle").value = log?.title || "";
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
  form.hidden = true;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

function getLogSortKey(log) {
  if (log?.createdAt) return log.createdAt;
  if (log?.updatedAt) return log.updatedAt;
  return "0000-00-00T00:00:00.000Z";
}

function getLogRangeDate(log) {
  if (log?.createdAt && typeof log.createdAt === "string") {
    return log.createdAt.slice(0, 10);
  }
  if (log?.updatedAt && typeof log.updatedAt === "string") {
    return log.updatedAt.slice(0, 10);
  }
  if (log?.date) return log.date;
  return "";
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
  state.labLogs.sort((a, b) => getLogSortKey(b).localeCompare(getLogSortKey(a)) || a.title.localeCompare(b.title));
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
  const template = document.getElementById("todoItemTemplate");
  if (!list || !template) return;
  list.innerHTML = "";
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
  const template = document.getElementById("journalItemTemplate");
  if (!list || !template) return;
  list.innerHTML = "";
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

function calculateLedgerTotal() {
  return LEDGER_TOTAL_KEYS.reduce((sum, key) => {
    const value = state.ledger?.[key];
    return sum + ledgerValueToNumber(value);
  }, 0);
}

function renderLedgerTotal() {
  const totalEl = document.getElementById("ledgerTotal");
  if (!totalEl) return;
  const total = calculateLedgerTotal();
  totalEl.textContent = formatLedgerTotal(total);
}

function renderLedger() {
  const container = document.getElementById("ledgerBody");
  if (!container) return;
  LEDGER_FIELDS.forEach(({ key }) => {
    const input = container.querySelector(`[data-ledger-field="${key}"]`);
    if (!input) return;
    const value = state.ledger?.[key] ?? "";
    if (input.value !== value) {
      input.value = value;
    }
    updateLedgerInputVisual(input);
  });
  renderLedgerTotal();
  renderLedgerHistory();
}

function setLedgerToggleIcon(toggle, expanded) {
  if (!toggle) return;
  const icon = toggle.querySelector("[data-ledger-eye]");
  if (icon) {
    icon.textContent = expanded ? "—" : "▾";
  }
}

function saveLedger() {
  persist(STORAGE_KEYS.ledger, state.ledger);
}

function updateLedgerField(field, value) {
  if (!LEDGER_FIELDS.some(({ key }) => key === field)) return;
  const normalized = value == null ? "" : String(value);
  if (state.ledger[field] === normalized) {
    renderLedgerTotal();
    return;
  }
  state.ledger[field] = normalized;
  saveLedger();
  renderLedgerTotal();
}

function handleLedgerInputEvent(event) {
  const input = event.currentTarget;
  const field = input?.dataset?.ledgerField;
  if (!field) return;
  updateLedgerField(field, input.value);
  updateLedgerInputVisual(input);
}

function handleLedgerBlur(event) {
  const input = event.currentTarget;
  const field = input?.dataset?.ledgerField;
  if (!field) return;
  const trimmed = input.value.trim();
  if (trimmed !== input.value) {
    input.value = trimmed;
  }
  updateLedgerField(field, trimmed);
  updateLedgerInputVisual(input);
}

function getActiveLedgerDate() {
  return state.selectedDate || nowInTimeZone().date;
}

function persistLedgerHistory() {
  persist(STORAGE_KEYS.ledgerHistory, state.ledgerHistory);
}

function recordLedgerAdjustment(field, direction, amount) {
  const date = getActiveLedgerDate();
  if (!date || !LEDGER_FIELDS.some((item) => item.key === field)) return;
  const absAmount = Math.abs(amount);
  const roundedAmount = roundLedgerAmount(absAmount);
  if (roundedAmount === 0) return;
  const delta = direction === "subtract" ? -roundedAmount : roundedAmount;
  if (!state.ledgerHistory[date]) {
    state.ledgerHistory[date] = [];
  }
  const entry = {
    id: crypto.randomUUID(),
    date,
    field,
    direction,
    delta,
    createdAt: new Date().toISOString(),
  };
  state.ledgerHistory[date].push(entry);
  persistLedgerHistory();
  renderLedgerHistory();
}

function removeLedgerAdjustment(date, id) {
  if (!date || !id) return;
  const entries = Array.isArray(state.ledgerHistory?.[date]) ? state.ledgerHistory[date] : null;
  if (!entries || !entries.length) return;
  const index = entries.findIndex((entry) => entry.id === id);
  if (index === -1) return;
  const entry = entries[index];
  const field = entry.field;
  const label = getLedgerFieldLabel(field);
  const hasContent = Math.abs(entry.delta) > 0;
  const shouldRemove = !hasContent
    ? true
    : window.confirm(`Remove this adjustment for ${label}?`);
  if (!shouldRemove) {
    return;
  }
  if (hasContent) {
    const current = getLedgerCurrentValue(field);
    const next = current - entry.delta;
    const roundedNext = roundLedgerAmount(next);
    const normalizedValue = Math.abs(roundedNext) === 0 ? 0 : roundedNext;
    updateLedgerField(field, String(normalizedValue));
    const input = document.querySelector(`[data-ledger-field="${field}"]`);
    if (input) {
      input.value = String(normalizedValue);
      updateLedgerInputVisual(input);
    }
  }
  entries.splice(index, 1);
  if (!entries.length) {
    delete state.ledgerHistory[date];
  }
  persistLedgerHistory();
  renderLedgerHistory();
}

function formatLedgerHistoryTime(isoString) {
  if (!isoString) return "";
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: getTimeZone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function renderLedgerHistory() {
  const list = document.getElementById("ledgerHistory");
  const emptyMessage = document.getElementById("ledgerHistoryEmpty");
  if (!list) return;
  const date = getActiveLedgerDate();
  const entries = Array.isArray(state.ledgerHistory?.[date])
    ? state.ledgerHistory[date]
        .slice()
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    : [];
  list.innerHTML = "";
  if (!entries.length) {
    list.hidden = true;
    if (emptyMessage) {
      emptyMessage.hidden = false;
    }
    return;
  }
  list.hidden = false;
  if (emptyMessage) {
    emptyMessage.hidden = true;
  }
  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const item = document.createElement("div");
    item.className = "ledger-history-item";
    item.setAttribute("role", "listitem");
    const time = document.createElement("span");
    time.className = "ledger-history-time";
    time.textContent = formatLedgerHistoryTime(entry.createdAt);
    item.appendChild(time);
    const description = document.createElement("span");
    description.className = "ledger-history-description";
    const label = getLedgerFieldLabel(entry.field);
    const sign = entry.direction === "subtract" ? "-" : "+";
    const amount = formatLedgerTotal(Math.abs(entry.delta));
    description.textContent = `${label} ${sign}${amount}`;
    item.appendChild(description);
    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "ledger-history-remove";
    removeBtn.textContent = "✕";
    removeBtn.setAttribute("aria-label", `Remove adjustment for ${label}`);
    removeBtn.dataset.ledgerHistoryDate = entry.date;
    removeBtn.dataset.ledgerHistoryId = entry.id;
    removeBtn.addEventListener("click", handleLedgerHistoryRemoveClick);
    item.appendChild(removeBtn);
    fragment.appendChild(item);
  });
  list.appendChild(fragment);
}

function handleLedgerHistoryRemoveClick(event) {
  const button = event.currentTarget;
  const { ledgerHistoryDate: date, ledgerHistoryId: id } = button.dataset;
  removeLedgerAdjustment(date, id);
}

function getLedgerCurrentValue(field) {
  const input = document.querySelector(`[data-ledger-field="${field}"]`);
  const stateValue = ledgerValueToNumber(state.ledger?.[field]);
  if (!input) {
    return stateValue;
  }
  const trimmed = input.value.trim();
  if (!trimmed) {
    return stateValue;
  }
  const liveValue = ledgerValueToNumber(trimmed);
  return Number.isFinite(liveValue) ? liveValue : stateValue;
}

function handleLedgerAdjustClick(event) {
  const button = event.currentTarget;
  const field = button?.dataset?.ledgerField;
  const direction = button?.dataset?.ledgerDirection;
  if (!field || !direction) return;
  const label = getLedgerFieldLabel(field);
  const promptMessage = direction === "add" ? `Enter the amount to add to ${label}` : `Enter the amount to subtract from ${label}`;
  const raw = window.prompt(promptMessage, "");
  if (raw == null) return;
  const normalized = raw.replace(/,/g, "").trim();
  if (!normalized) return;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) {
    showToast("Please enter a valid number.");
    return;
  }
  if (numeric === 0) {
    return;
  }
  const current = getLedgerCurrentValue(field);
  const amount = roundLedgerAmount(Math.abs(numeric));
  if (amount === 0) {
    return;
  }
  const nextValue = direction === "add" ? current + amount : current - amount;
  const rounded = roundLedgerAmount(nextValue);
  const normalizedValue = Math.abs(rounded) === 0 ? 0 : rounded;
  updateLedgerField(field, String(normalizedValue));
  const input = document.querySelector(`[data-ledger-field="${field}"]`);
  if (input) {
    input.value = String(normalizedValue);
    updateLedgerInputVisual(input);
  }
  renderLedgerTotal();
  recordLedgerAdjustment(field, direction, amount);
}

function toggleLedgerVisibility() {
  const body = document.getElementById("ledgerBody");
  const toggle = document.getElementById("toggleLedger");
  if (!body || !toggle) return;
  const willHide = !body.hidden;
  body.hidden = willHide;
  body.classList.toggle("collapsed", willHide);
  const expanded = !body.hidden;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute("aria-label", expanded ? "Hide ledger" : "Show ledger");
  toggle.setAttribute("title", expanded ? "Hide ledger" : "Show ledger");
  toggle.classList.toggle("collapsed", !expanded);
  setLedgerToggleIcon(toggle, expanded);
}

function setupLedgerModule() {
  const toggle = document.getElementById("toggleLedger");
  const body = document.getElementById("ledgerBody");
  if (toggle && body) {
    toggle.addEventListener("click", () => {
      toggleLedgerVisibility();
    });
    const expanded = !body.hidden;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", expanded ? "Hide ledger" : "Show ledger");
    toggle.setAttribute("title", expanded ? "Hide ledger" : "Show ledger");
    toggle.classList.toggle("collapsed", !expanded);
    body.classList.toggle("collapsed", body.hidden);
    setLedgerToggleIcon(toggle, expanded);
  }
  const inputs = document.querySelectorAll("[data-ledger-field]");
  inputs.forEach((input) => {
    input.addEventListener("input", handleLedgerInputEvent);
    input.addEventListener("blur", handleLedgerBlur);
    updateLedgerInputVisual(input);
  });
  const adjustButtons = document.querySelectorAll("[data-ledger-direction]");
  adjustButtons.forEach((button) => {
    button.addEventListener("click", handleLedgerAdjustClick);
  });
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
    .sort((a, b) => getLogSortKey(b).localeCompare(getLogSortKey(a)) || a.title.localeCompare(b.title))
    .forEach((log) => {
      const node = template.content.firstElementChild.cloneNode(true);
      node.dataset.id = log.id;

      const titleEl = node.querySelector(".log-title");
      titleEl.textContent = log.title;

      const metaEl = node.querySelector(".log-meta");
      metaEl.innerHTML = "";
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
          const extras = Array.isArray(step?.sequence)
            ? step.sequence
                .map((entry) => {
                  if (!entry) return null;
                  const type = entry.type === "code" ? "code" : "commit";
                  const value = (entry.value == null ? "" : String(entry.value)).trim();
                  if (!value) return null;
                  return { type, value };
                })
                .filter(Boolean)
            : (() => {
                const commitEntries = Array.isArray(step?.commits)
                  ? step.commits
                      .map((entry) => (entry == null ? "" : String(entry)).trim())
                      .filter((entry) => entry)
                  : [];
                const codeEntries = [];
                if (Array.isArray(step?.codes)) codeEntries.push(...step.codes);
                if (typeof step?.code === "string") codeEntries.push(step.code);
                const filteredCodes = codeEntries
                  .map((entry) => (entry == null ? "" : String(entry)).trim())
                  .filter((entry) => entry);
                return [
                  ...commitEntries.map((value) => ({ type: "commit", value })),
                  ...filteredCodes.map((value) => ({ type: "code", value })),
                ];
              })();

          if (extras.length) {
            const extrasList = document.createElement("ul");
            extrasList.className = "log-step-extras";
            extras.forEach((entry) => {
              const extraItem = document.createElement("li");
              extraItem.className = `log-step-extra log-step-extra-${entry.type}`;
              const valueSpan = document.createElement("span");
              valueSpan.className = "log-step-extra-text";
              valueSpan.textContent = entry.value;
              extraItem.appendChild(valueSpan);
              extrasList.appendChild(extraItem);
            });
            item.appendChild(extrasList);
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
  if (!list) return;

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

  const todayInfo = nowInTimeZone();
  const todayDate = todayInfo?.date || null;

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

    const todosForDate = state.todos.filter((t) => t.date === date);
    const hasTodoContent = todosForDate.length > 0;
    const allTodosDone = hasTodoContent && todosForDate.every((todo) => todo.done);
    const ratingEntry = state.dayRatings.find((entry) => entry.date === date) || null;
    let hasTimes = false;
    let workValue = "";
    let trainingValue = "";
    if (ratingEntry) {
      const workRaw = typeof ratingEntry.workTime === "string" ? ratingEntry.workTime.trim() : "";
      const trainingRaw = typeof ratingEntry.trainingTime === "string" ? ratingEntry.trainingTime.trim() : "";
      const hasWork = workRaw !== "";
      const hasTraining = trainingRaw !== "";
      if (hasWork || hasTraining) {
        hasTimes = true;
        workValue = hasWork ? workRaw : "0";
        trainingValue = hasTraining ? trainingRaw : "0";
      }
    }

    const labelParts = [hasTodoContent ? `${date} has todos` : date];

    if (hasTimes) {
      labelParts.push(`work ${workValue}, training ${trainingValue}`);
    }

    if (hasTimes || hasTodoContent) {
      const indicator = document.createElement("span");
      indicator.className = "day-indicator";

      if (hasTimes) {
        const timeHint = document.createElement("span");
        timeHint.className = "day-time-hint";
        timeHint.textContent = `${workValue}, ${trainingValue}`;
        timeHint.setAttribute("aria-hidden", "true");
        indicator.appendChild(timeHint);
      }

      if (hasTodoContent) {
        const star = document.createElement("span");
        star.className = "day-star";
        star.textContent = "★";
        star.setAttribute("aria-hidden", "true");

        const diffFromToday = getDayDifference(date, todayDate);
        if (allTodosDone) {
          star.classList.add("star-complete");
        } else if (diffFromToday != null) {
          if (diffFromToday >= 0) {
            star.classList.add("star-future");
          } else if (diffFromToday >= -7) {
            star.classList.add("star-recent");
          } else {
            star.classList.add("star-past");
          }
        }

        indicator.appendChild(star);

        if (allTodosDone) {
          labelParts.push("todos complete");
        }
      }

      if (indicator.childNodes.length > 0) {
        cell.appendChild(indicator);
      }
    }

    const labelText = labelParts.join(", ");
    cell.setAttribute("aria-label", labelText);
    cell.title = labelText;

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

function goToToday() {
  const current = nowInTimeZone();
  const today = current?.date || new Date().toISOString().slice(0, 10);
  setSelectedDate(today);
}

function setupEventHandlers() {
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }
  ["filterDateFrom", "filterDateTo", "filterStatus", "filterTags"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      renderTodos();
      renderJournal();
      renderCalendar();
    });
  });

  const prevPeriod = document.getElementById("prevPeriod");
  const nextPeriod = document.getElementById("nextPeriod");
  const todayButton = document.getElementById("todayButton");
  prevPeriod?.addEventListener("click", () => changeCalendarPeriod(-1));
  nextPeriod?.addEventListener("click", () => changeCalendarPeriod(1));
  todayButton?.addEventListener("click", goToToday);

  const todoForm = document.getElementById("todoForm");
  const cancelTodo = document.getElementById("cancelTodo");
  todoForm?.addEventListener("submit", handleTodoSubmit);
  cancelTodo?.addEventListener("click", () => {
    closeTodoForm();
  });

  const journalForm = document.getElementById("journalForm");
  const cancelJournal = document.getElementById("cancelJournal");
  journalForm?.addEventListener("submit", handleJournalSubmit);
  cancelJournal?.addEventListener("click", () => {
    closeJournalForm();
  });

  const logForm = document.getElementById("logForm");
  logForm?.addEventListener("submit", handleLogSubmit);
  const cancelLog = document.getElementById("cancelLog");
  cancelLog?.addEventListener("click", () => {
    closeLogForm();
  });
  const addStepBtn = document.getElementById("addLogStep");
  if (addStepBtn) {
    addStepBtn.addEventListener("click", () => {
      const row = addLogStepRow();
      row?.querySelector(".step-note")?.focus();
    });
  }

  const dayCommitNotes = document.getElementById("dayCommitNotes");
  if (dayCommitNotes) {
    dayCommitNotes.addEventListener("input", (event) => {
      autoResize(event.target);
      handleDayRatingCommitInput();
    });
  }
  logForm?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeLogForm();
    }
  });

  const journalContent = document.getElementById("journalContent");
  journalContent?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      journalForm?.requestSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeJournalForm();
    }
  });

  const todoNote = document.getElementById("todoNote");
  todoNote?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      todoForm?.requestSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeTodoForm();
    }
  });

  const todoTitle = document.getElementById("todoTitle");
  todoTitle?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      todoForm?.requestSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeTodoForm();
    }
  });

  const newTodoBtn = document.getElementById("newTodoBtn");
  newTodoBtn?.addEventListener("click", () => {
    openTodoForm();
  });
  const newJournalBtn = document.getElementById("newJournalBtn");
  newJournalBtn?.addEventListener("click", () => {
    openJournalForm();
  });
  const newLogBtn = document.getElementById("newLogBtn");
  newLogBtn?.addEventListener("click", () => {
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
      const hasJournal = document.getElementById("journalForm");
      if (hasJournal) {
        event.preventDefault();
        openJournalForm();
      }
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

  const exportTodoBtn = document.getElementById("exportTodosTxtRange");
  const exportLogsBtn = document.getElementById("exportLogsTxt");
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
  const dateInput = document.getElementById("journalDate");
  const timeInput = document.getElementById("journalTime");
  const contentInput = document.getElementById("journalContent");
  if (!dateInput || !timeInput || !contentInput) return;
  const date = dateInput.value;
  const time = timeInput.value;
  const content = contentInput.value.trim();
  if (!date || !time || !content) {
    showToast("Date, time, and content are required");
    return;
  }
  const tagsInput = document.getElementById("journalTags");
  const tags = parseTags(tagsInput ? tagsInput.value : "");
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
    const extras = Array.from(row.querySelectorAll(".step-field[data-extra-type]"))
      .map((field) => {
        const type = field.dataset.extraType === "code" ? "code" : "commit";
        const textarea = field.querySelector("textarea");
        const value = textarea?.value.trim() || "";
        if (!value) return null;
        return { type, value };
      })
      .filter(Boolean);
    const commitExtras = extras
      .filter((entry) => entry.type === "commit")
      .map((entry) => entry.value);
    const codes = extras
      .filter((entry) => entry.type === "code")
      .map((entry) => entry.value);
    const datasetValue = row.dataset.stepCreated;
    const baseDate = typeof datasetValue === "string" && datasetValue.includes("T") ? datasetValue.slice(0, 10) : null;
    const createdAt = normalizeStepCreatedAt(datasetValue, baseDate, datasetValue);
    row.dataset.stepCreated = createdAt;
    refreshStepRowTimestamp(row);
    const stepData = {
      id: row.dataset.stepId || crypto.randomUUID(),
      note,
      createdAt,
    };
    if (commitExtras.length) stepData.commits = commitExtras;
    if (codes.length) stepData.codes = codes;
    if (extras.length) stepData.sequence = extras;
    return stepData;
  });
}

function handleLogSubmit(event) {
  event.preventDefault();
  const title = document.getElementById("logTitle").value.trim();
  if (!title) {
    showToast("Title cannot be empty");
    document.getElementById("logTitle").focus();
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
  const descriptionValue = document.getElementById("logDescription").value.trim();

  const log = {
    id: state.editingLogId || crypto.randomUUID(),
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title,
    ...(descriptionValue ? { description: descriptionValue } : {}),
    steps,
    ...(resultsValue ? { results: resultsValue } : {}),
  };

  upsertLog(log);
  state.editingLogId = null;
  renderLogs();
  renderCalendar();
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
    .filter((log) => {
      const rangeDate = getLogRangeDate(log);
      return rangeDate && rangeDate >= from && rangeDate <= to;
    })
    .slice()
    .sort((a, b) => getLogSortKey(b).localeCompare(getLogSortKey(a)) || a.title.localeCompare(b.title));
  if (!logs.length) {
    showToast("No research logs in the selected range");
    return;
  }

  const blocks = logs.map((log) => {
    const headerStamp = formatStepTimestamp(log.createdAt) || getLogRangeDate(log);
    const titleLine = headerStamp ? `${log.title} — ${headerStamp}` : log.title;
    const lines = [titleLine];
    if (log.description) lines.push(`Description: ${log.description}`);
    if (log.results) lines.push(`Results: ${log.results}`);
    if (log.steps?.length) {
      lines.push("Operations:");
      log.steps.forEach((step) => {
        const stamp = step.createdAt ? formatStepTimestamp(step.createdAt) : "";
        const prefix = stamp ? `[${stamp}] ` : "";
        lines.push(`  - ${prefix}${step.note}`);
        const extras = Array.isArray(step?.sequence)
          ? step.sequence
              .map((entry) => {
                if (!entry) return null;
                const type = entry.type === "code" ? "code" : "commit";
                const value = (entry.value == null ? "" : String(entry.value)).trim();
                if (!value) return null;
                return { type, value };
              })
              .filter(Boolean)
          : (() => {
              const commitEntries = Array.isArray(step?.commits)
                ? step.commits
                    .map((entry) => (entry == null ? "" : String(entry)).trim())
                    .filter((entry) => entry)
                : [];
              const codeEntries = [];
              if (Array.isArray(step?.codes)) codeEntries.push(...step.codes);
              if (typeof step?.code === "string") codeEntries.push(step.code);
              const filteredCodes = codeEntries
                .map((entry) => (entry == null ? "" : String(entry)).trim())
                .filter((entry) => entry);
              return [
                ...commitEntries.map((value) => ({ type: "commit", value })),
                ...filteredCodes.map((value) => ({ type: "code", value })),
              ];
            })();
        extras.forEach((entry) => {
          lines.push(`      ${entry.value}`);
        });
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
  setupWorkspaceSidebar();
  setupDayRatingPickers();
  setupEventHandlers();
  setupLedgerModule();
  const now = nowInTimeZone();
  const journalDate = document.getElementById("journalDate");
  const journalTime = document.getElementById("journalTime");
  if (journalDate) journalDate.value = state.selectedDate || now.date;
  if (journalTime) journalTime.value = now.time;
  resetLogSteps([{ createdAt: new Date().toISOString() }]);
  refreshAutosizeWithin(document);
  document.getElementById("selectedDateLabel").textContent = formatter.label(state.selectedDate);
  const exportFrom = document.getElementById("exportDateFrom");
  const exportTo = document.getElementById("exportDateTo");
  if (exportFrom) exportFrom.value = state.selectedDate;
  if (exportTo) exportTo.value = state.selectedDate;
  renderDayRating();
  renderCalendar();
  renderTodos();
  renderJournal();
  renderLedger();
  renderLogs();
}

window.addEventListener("DOMContentLoaded", initialize);

// Self-check: data persists after refresh; TXT export preserves order; calendar selection stays in sync; filters respond immediately; keyboard shortcuts and focus work; drag/drop sorting saves instantly.
