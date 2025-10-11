const STORAGE_KEYS = {
  journal: "dm_journal",
  todos: "dm_todos",
  settings: "dm_settings",
};

const DEFAULT_SETTINGS = {
  theme: "light",
  view: "month",
  selectedDate: null,
};

const state = {
  journal: [],
  todos: [],
  settings: { ...DEFAULT_SETTINGS },
  selectedDate: null,
  view: "month",
  calendarAnchor: null,
  editingTodoId: null,
  editingJournalId: null,
};

const formatter = {
  date(date) {
    return new Date(date).toLocaleString("sv-SE", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).slice(0, 10);
  },
  time(date) {
    return new Date(date).toLocaleString("en-GB", {
      timeZone: "Europe/London",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    });
  },
  label(date) {
    const d = new Date(date + "T00:00:00Z");
    return new Intl.DateTimeFormat("zh-Hans", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "long",
      day: "2-digit",
      weekday: "long",
    }).format(d);
  },
};

function nowLondon() {
  const iso = new Date().toLocaleString("sv-SE", {
    timeZone: "Europe/London",
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
  state.view = state.settings.view || "month";
  state.selectedDate = state.settings.selectedDate || nowLondon().date;
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
    view: state.view,
    selectedDate: state.selectedDate,
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

function setSelectedDate(date) {
  state.selectedDate = date;
  state.settings.selectedDate = date;
  state.calendarAnchor = date;
  document.getElementById("selectedDateLabel").textContent = formatter.label(date);
  document.getElementById("journalDate").value = date;
  const exportFrom = document.getElementById("journalExportFrom");
  const exportTo = document.getElementById("journalExportTo");
  if (!exportFrom.value) exportFrom.value = date;
  if (!exportTo.value) exportTo.value = date;
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

function filteredTodos() {
  const search = document.getElementById("globalSearch").value.trim().toLowerCase();
  const status = document.getElementById("filterStatus").value;
  const priority = document.getElementById("filterPriority").value;
  const dateFrom = document.getElementById("filterDateFrom").value;
  const dateTo = document.getElementById("filterDateTo").value;
  const tags = parseTags(document.getElementById("filterTags").value.toLowerCase());

  return state.todos.filter((todo) => {
    if (dateFrom && todo.date < dateFrom) return false;
    if (dateTo && todo.date > dateTo) return false;
    if (status === "pending" && todo.done) return false;
    if (status === "done" && !todo.done) return false;
    if (priority !== "all" && String(todo.priority) !== priority) return false;

    const haystack = `${todo.title} ${todo.note}`.toLowerCase();
    const tagMatch = tags.length
      ? tags.every((tag) => haystack.includes(tag) || (todo.tags || []).some((t) => t.toLowerCase().includes(tag)))
      : true;
    const searchMatch = search ? haystack.includes(search) : true;

    return tagMatch && searchMatch;
  });
}

function filteredJournal() {
  const search = document.getElementById("globalSearch").value.trim().toLowerCase();
  const dateFrom = document.getElementById("filterDateFrom").value;
  const dateTo = document.getElementById("filterDateTo").value;
  const tags = parseTags(document.getElementById("filterTags").value.toLowerCase());

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
    node.querySelector(".todo-done").checked = !!todo.done;
    const titleEl = node.querySelector(".todo-title");
    titleEl.textContent = `${todo.order}. ${todo.title}`;
    titleEl.classList.toggle("done", todo.done);
    node.querySelector(
      ".todo-meta"
    ).textContent = `优先级 ${todo.priority} · ${todo.date}` + (todo.note ? "" : " (无备注)");
    const noteEl = node.querySelector(".todo-note");
    noteEl.textContent = todo.note || "";
    if (!todo.note) {
      node.querySelector(".toggle-note").setAttribute("aria-hidden", "true");
      node.querySelector(".toggle-note").hidden = true;
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
      node.querySelector(".journal-time").textContent = `${entry.date} ${entry.time}`;
      const contentEl = node.querySelector(".journal-content");
      contentEl.textContent = entry.content;
      if (entry.content.length > 160) {
        const expandBtn = document.createElement("button");
        expandBtn.type = "button";
        expandBtn.textContent = "展开全文";
        expandBtn.className = "btn ghost";
        expandBtn.addEventListener("click", () => {
          contentEl.classList.toggle("expanded");
          expandBtn.textContent = contentEl.classList.contains("expanded") ? "收起" : "展开全文";
        });
        node.querySelector(".journal-body").appendChild(expandBtn);
      }
      node.querySelector(".journal-tags").textContent = entry.tags?.length
        ? entry.tags.map((tag) => `#${tag}`).join(" ")
        : "无标签";
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

  list.querySelectorAll(".todo-actions .edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".todo-item").dataset.id;
      const todo = state.todos.find((t) => t.id === id);
      if (!todo) return;
      state.editingTodoId = id;
      document.getElementById("todoTitle").value = todo.title;
      document.getElementById("todoPriority").value = todo.priority;
      document.getElementById("todoNote").value = todo.note || "";
      document.getElementById("todoTitle").focus();
    });
  });

  list.querySelectorAll(".todo-actions .delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".todo-item").dataset.id;
      if (confirm("确定删除这条代办吗？")) {
        deleteTodo(id);
        showToast("代办已删除");
      }
    });
  });

  list.querySelectorAll(".todo-actions .up").forEach((btn) => {
    btn.addEventListener("click", () => moveTodo(btn.closest(".todo-item").dataset.id, -1));
  });

  list.querySelectorAll(".todo-actions .down").forEach((btn) => {
    btn.addEventListener("click", () => moveTodo(btn.closest(".todo-item").dataset.id, 1));
  });

  list.querySelectorAll(".toggle-note").forEach((btn) => {
    btn.addEventListener("click", () => {
      const note = btn.nextElementSibling;
      const expanded = note.hidden;
      note.hidden = !expanded;
      btn.textContent = expanded ? "收起备注" : "展开备注";
    });
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
      state.editingJournalId = id;
      document.getElementById("journalDate").value = entry.date;
      document.getElementById("journalTime").value = entry.time;
      document.getElementById("journalTags").value = entry.tags?.join(", ") || "";
      document.getElementById("journalContent").value = entry.content;
      document.getElementById("journalContent").focus();
    });
  });

  document.querySelectorAll(".journal-item .delete").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.closest(".journal-item").dataset.id;
      if (confirm("确定删除这条日记吗？")) {
        deleteJournal(id);
        showToast("日记已删除");
      }
    });
  });
}

function renderCalendar() {
  const grid = document.getElementById("calendarGrid");
  grid.innerHTML = "";
  const label = document.getElementById("calendarLabel");
  const view = state.view;
  let dates = [];
  const anchorDate = state.calendarAnchor;
  const anchor = new Date(anchorDate + "T00:00:00");

  if (view === "month") {
    const year = anchor.getFullYear();
    const month = anchor.getMonth();
    const firstDay = new Date(Date.UTC(year, month, 1));
    const firstWeekday = (firstDay.getDay() + 6) % 7; // Monday as first
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const start = new Date(firstDay);
    start.setUTCDate(firstDay.getUTCDate() - firstWeekday);
    for (let i = 0; i < 42; i++) {
      const current = new Date(start);
      current.setUTCDate(start.getUTCDate() + i);
      dates.push(current.toISOString().slice(0, 10));
    }
    label.textContent = `${year} 年 ${month + 1} 月`;
  } else if (view === "week") {
    const current = new Date(anchor);
    const weekday = (current.getDay() + 6) % 7;
    current.setDate(current.getDate() - weekday);
    for (let i = 0; i < 7; i++) {
      const day = new Date(current);
      day.setDate(current.getDate() + i);
      dates.push(formatter.date(day));
    }
    const startLabel = dates[0];
    const endLabel = dates[6];
    label.textContent = `${startLabel} → ${endLabel}`;
  } else {
    dates = [state.selectedDate];
    label.textContent = formatter.label(state.selectedDate);
  }

  const fragment = document.createDocumentFragment();
  dates.forEach((date) => {
    const cell = document.createElement("button");
    cell.className = "calendar-cell";
    cell.type = "button";
    cell.setAttribute("role", "gridcell");
    cell.dataset.date = date;
    cell.innerHTML = `<span class="date-number">${date.slice(8)}</span>`;
    const todoCount = state.todos.filter((t) => t.date === date).length;
    const journalCount = state.journal.filter((j) => j.date === date).length;
    const counts = document.createElement("div");
    counts.className = "counts";
    counts.textContent = `${todoCount} 代办 · ${journalCount} 日记`;
    cell.appendChild(counts);
    if (date === state.selectedDate) {
      cell.classList.add("selected");
      cell.setAttribute("aria-selected", "true");
    }
    cell.addEventListener("click", () => setSelectedDate(date));
    fragment.appendChild(cell);
  });
  grid.appendChild(fragment);
}

function changeCalendarPeriod(offset) {
  const anchor = new Date(state.calendarAnchor + "T00:00:00");
  if (state.view === "month") {
    anchor.setMonth(anchor.getMonth() + offset);
  } else if (state.view === "week") {
    anchor.setDate(anchor.getDate() + offset * 7);
  } else {
    anchor.setDate(anchor.getDate() + offset);
  }
  state.calendarAnchor = formatter.date(anchor);
  renderCalendar();
}

function setupEventHandlers() {
  document.getElementById("themeToggle").addEventListener("click", toggleTheme);
  document.getElementById("globalSearch").addEventListener("input", () => {
    renderTodos();
    renderJournal();
  });

  ["filterDateFrom", "filterDateTo", "filterStatus", "filterPriority", "filterTags"].forEach((id) => {
    document.getElementById(id).addEventListener("input", () => {
      renderTodos();
      renderJournal();
      renderCalendar();
    });
  });

  document.querySelectorAll(".view-switch button").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".view-switch button").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });
      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");
      state.view = btn.dataset.view;
      state.settings.view = state.view;
      renderCalendar();
      saveSettings();
    });
  });

  document.getElementById("prevPeriod").addEventListener("click", () => changeCalendarPeriod(-1));
  document.getElementById("nextPeriod").addEventListener("click", () => changeCalendarPeriod(1));

  document.getElementById("todoForm").addEventListener("submit", handleTodoSubmit);
  document.getElementById("cancelTodo").addEventListener("click", () => {
    state.editingTodoId = null;
    document.getElementById("todoForm").reset();
  });

  document.getElementById("journalForm").addEventListener("submit", handleJournalSubmit);
  document.getElementById("cancelJournal").addEventListener("click", () => {
    state.editingJournalId = null;
    document.getElementById("journalForm").reset();
    const now = nowLondon();
    document.getElementById("journalDate").value = state.selectedDate || now.date;
    document.getElementById("journalTime").value = now.time;
  });

  document.getElementById("journalContent").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.getElementById("journalForm").requestSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      document.getElementById("cancelJournal").click();
    }
  });

  document.getElementById("todoNote").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.getElementById("todoForm").requestSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      document.getElementById("cancelTodo").click();
    }
  });

  document.getElementById("todoTitle").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      document.getElementById("todoForm").requestSubmit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      document.getElementById("cancelTodo").click();
    }
  });

  document.getElementById("globalSearch").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.target.value = "";
      event.target.dispatchEvent(new Event("input"));
    }
  });

  document.getElementById("newTodoBtn").addEventListener("click", () => {
    state.editingTodoId = null;
    document.getElementById("todoForm").reset();
    document.getElementById("todoTitle").focus();
  });
  document.getElementById("newJournalBtn").addEventListener("click", () => {
    state.editingJournalId = null;
    const now = nowLondon();
    document.getElementById("journalDate").value = state.selectedDate || now.date;
    document.getElementById("journalTime").value = now.time;
    document.getElementById("journalContent").focus();
  });

  document.addEventListener("keydown", (event) => {
    if (event.target.matches("input, textarea")) return;
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      document.getElementById("newTodoBtn").click();
    }
    if (event.key.toLowerCase() === "j") {
      event.preventDefault();
      document.getElementById("newJournalBtn").click();
    }
    if (event.key === "/") {
      event.preventDefault();
      document.getElementById("globalSearch").focus();
    }
    if (event.key.toLowerCase() === "t") {
      event.preventDefault();
      toggleTheme();
    }
  });

  document.getElementById("exportJournalCsv").addEventListener("click", () => exportJournal("csv"));
  document.getElementById("exportJournalJson").addEventListener("click", () => exportJournal("json"));
  document.getElementById("exportTodosCsv").addEventListener("click", () => exportTodosForDate(state.selectedDate, "csv"));
  document.getElementById("exportTodosCsvRange").addEventListener("click", () => exportTodosFiltered("csv"));
  document.getElementById("exportTodosJsonRange").addEventListener("click", () => exportTodosFiltered("json"));

  document.getElementById("exportBackup").addEventListener("click", exportBackup);
  document.getElementById("importBackup").addEventListener("change", importBackup);
}

function handleTodoSubmit(event) {
  event.preventDefault();
  const title = document.getElementById("todoTitle").value.trim();
  if (!title) {
    showToast("标题不能为空");
    document.getElementById("todoTitle").focus();
    return;
  }
  const note = document.getElementById("todoNote").value.trim();
  const priority = Number(document.getElementById("todoPriority").value);
  const id = state.editingTodoId || crypto.randomUUID();
  const todo = state.todos.find((t) => t.id === id) || {
    id,
    date: state.selectedDate,
    done: false,
    order: state.todos.filter((t) => t.date === state.selectedDate).length + 1,
  };
  todo.title = title;
  todo.note = note;
  todo.priority = priority;
  todo.date = state.selectedDate;
  upsertTodo(todo);
  state.editingTodoId = null;
  event.target.reset();
  renderTodos();
  renderCalendar();
  showToast("代办已保存");
}

function handleJournalSubmit(event) {
  event.preventDefault();
  const date = document.getElementById("journalDate").value;
  const time = document.getElementById("journalTime").value;
  const content = document.getElementById("journalContent").value.trim();
  if (!date || !time || !content) {
    showToast("日期、时间与内容不能为空");
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
  event.target.reset();
  const now = nowLondon();
  document.getElementById("journalDate").value = state.selectedDate || now.date;
  document.getElementById("journalTime").value = now.time;
  showToast("日记已保存");
}

function exportJournal(format) {
  const from = document.getElementById("journalExportFrom").value || state.selectedDate;
  const to = document.getElementById("journalExportTo").value || state.selectedDate;
  const entries = state.journal.filter((entry) => entry.date >= from && entry.date <= to);
  if (!entries.length) {
    showToast("所选范围无日记记录");
    return;
  }
  if (format === "csv") {
    const header = "date,time,content,tags";
    const rows = entries.map((entry) => {
      const tags = entry.tags?.join(";") || "";
      const safeContent = entry.content.replace(/"/g, '""');
      return `${entry.date},${entry.time},"${safeContent}","${tags}"`;
    });
    downloadFile(`journal_${from}_${to}.csv`, [header, ...rows].join("\n"));
  } else {
    const payload = {
      range: { from, to },
      journal: entries,
    };
    downloadFile(`journal_${from}_${to}.json`, JSON.stringify(payload, null, 2));
  }
  showToast("日记已导出");
}

function exportTodosForDate(date, format) {
  const todos = state.todos.filter((todo) => todo.date === date);
  if (!todos.length) {
    showToast("该日无代办");
    return;
  }
  if (format === "csv") {
    const header = "date,order,title,done,priority,note";
    const rows = todos
      .sort((a, b) => a.order - b.order)
      .map((todo) => {
        const safeTitle = todo.title.replace(/"/g, '""');
        const safeNote = (todo.note || "").replace(/"/g, '""');
        return `${todo.date},${todo.order},"${safeTitle}",${todo.done},${todo.priority},"${safeNote}"`;
      });
    downloadFile(`todos_${date}.csv`, [header, ...rows].join("\n"));
  }
  showToast("代办已导出");
}

function exportTodosFiltered(format) {
  const todos = filteredTodos();
  if (!todos.length) {
    showToast("当前筛选无代办");
    return;
  }
  if (format === "csv") {
    const header = "date,order,title,done,priority,note";
    const rows = todos
      .slice()
      .sort((a, b) => {
        if (a.date === b.date) return a.order - b.order;
        return a.date.localeCompare(b.date);
      })
      .map((todo) => {
        const safeTitle = todo.title.replace(/"/g, '""');
        const safeNote = (todo.note || "").replace(/"/g, '""');
        return `${todo.date},${todo.order},"${safeTitle}",${todo.done},${todo.priority},"${safeNote}"`;
      });
    downloadFile(`todos_filtered.csv`, [header, ...rows].join("\n"));
  } else {
    downloadFile(
      `todos_filtered.json`,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          todos,
        },
        null,
        2
      )
    );
  }
  showToast("代办已导出");
}

function exportBackup() {
  const payload = {
    version: 1,
    journal: state.journal,
    todos: state.todos,
  };
  downloadFile(`backup_${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
  showToast("备份已导出");
}

async function importBackup(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || data.version !== 1) throw new Error("版本不符");
    if (!Array.isArray(data.journal) || !Array.isArray(data.todos)) throw new Error("格式错误");
    state.journal = data.journal;
    state.todos = data.todos;
    saveAll();
    renderJournal();
    renderTodos();
    renderCalendar();
    showToast("备份已导入");
  } catch (error) {
    console.error(error);
    showToast("导入失败，请检查文件");
  } finally {
    event.target.value = "";
  }
}

function downloadFile(filename, content) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
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
  setupEventHandlers();
  const now = nowLondon();
  document.getElementById("journalDate").value = state.selectedDate || now.date;
  document.getElementById("journalTime").value = now.time;
  document.getElementById("selectedDateLabel").textContent = formatter.label(state.selectedDate);
  document.getElementById("filterDateFrom").value = state.selectedDate;
  document.getElementById("filterDateTo").value = state.selectedDate;
  document.querySelectorAll(`.view-switch button`).forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === state.view);
    btn.setAttribute("aria-selected", btn.dataset.view === state.view ? "true" : "false");
  });
  renderCalendar();
  renderTodos();
  renderJournal();
}

window.addEventListener("DOMContentLoaded", initialize);

// 自检：刷新后数据仍在；导出/导入保持顺序；日历选择同步；筛选搜索即时；键盘快捷键和焦点可用；拖拽/按钮排序立即保存。
