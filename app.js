const STORAGE_KEYS = {
  journal: "dm_journal",
  todos: "dm_todos",
  settings: "dm_settings",
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
  settings: { ...DEFAULT_SETTINGS },
  selectedDate: null,
  calendarAnchor: null,
  editingTodoId: null,
  editingJournalId: null,
};

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
    if (journalRaw) state.journal = JSON.parse(journalRaw);
    if (todosRaw) state.todos = JSON.parse(todosRaw);
    if (settingsRaw) state.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(settingsRaw) };
  } catch (error) {
    console.error("Failed to load local state", error);
  }
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
  closeTodoForm();
  closeJournalForm();
  const exportFrom = document.getElementById("exportDateFrom");
  const exportTo = document.getElementById("exportDateTo");
  if (exportFrom && !exportFrom.value) exportFrom.value = date;
  if (exportTo && !exportTo.value) exportTo.value = date;
  renderTodos();
  renderJournal();
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
  form.hidden = false;
  if (todo) {
    state.editingTodoId = todo.id;
    document.getElementById("todoTitle").value = todo.title;
    document.getElementById("todoNote").value = todo.note || "";
  } else {
    state.editingTodoId = null;
    form.reset();
  }
  document.getElementById("todoTitle").focus();
}

function closeTodoForm() {
  const form = document.getElementById("todoForm");
  form.reset();
  form.hidden = true;
  state.editingTodoId = null;
}

function openJournalForm(entry = null) {
  const form = document.getElementById("journalForm");
  form.hidden = false;
  const now = nowInTimeZone();
  const date = state.selectedDate || now.date;
  if (entry) {
    state.editingJournalId = entry.id;
    document.getElementById("journalDate").value = entry.date;
    document.getElementById("journalTime").value = entry.time;
    document.getElementById("journalTags").value = entry.tags?.join(", ") || "";
    document.getElementById("journalContent").value = entry.content;
  } else {
    state.editingJournalId = null;
    document.getElementById("journalForm").reset();
    document.getElementById("journalDate").value = date;
    document.getElementById("journalTime").value = now.time;
  }
  document.getElementById("journalContent").focus();
}

function closeJournalForm() {
  const form = document.getElementById("journalForm");
  form.reset();
  const now = nowInTimeZone();
  document.getElementById("journalDate").value = state.selectedDate || now.date;
  document.getElementById("journalTime").value = now.time;
  form.hidden = true;
  state.editingJournalId = null;
  document.getElementById("journalContent").value = "";
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
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

    const hasContent = state.todos.some((t) => t.date === date) || state.journal.some((j) => j.date === date);
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
    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      toggleTheme();
    }
  });

  const exportJournalBtn = document.getElementById("exportJournalTxt");
  const exportTodoBtn = document.getElementById("exportTodosTxtRange");
  if (exportJournalBtn) {
    exportJournalBtn.addEventListener("click", exportJournalTxt);
  }
  if (exportTodoBtn) {
    exportTodoBtn.addEventListener("click", exportTodosTxtRange);
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
  document.getElementById("selectedDateLabel").textContent = formatter.label(state.selectedDate);
  const exportFrom = document.getElementById("exportDateFrom");
  const exportTo = document.getElementById("exportDateTo");
  if (exportFrom) exportFrom.value = state.selectedDate;
  if (exportTo) exportTo.value = state.selectedDate;
  renderCalendar();
  renderTodos();
  renderJournal();
}

window.addEventListener("DOMContentLoaded", initialize);

// Self-check: data persists after refresh; TXT export preserves order; calendar selection stays in sync; filters respond immediately; keyboard shortcuts and focus work; drag/drop or button sorting saves instantly.
