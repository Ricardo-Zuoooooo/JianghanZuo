const STORAGE_KEYS = {
  journal: "dm_journal",
  todos: "dm_todos",
  settings: "dm_settings",
};

const DEFAULT_SETTINGS = {
  theme: "light",
  selectedDate: null,
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
  closeTodoForm();
  closeJournalForm();
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

function openTodoForm(todo = null) {
  const form = document.getElementById("todoForm");
  form.hidden = false;
  if (todo) {
    state.editingTodoId = todo.id;
    document.getElementById("todoTitle").value = todo.title;
    document.getElementById("todoPriority").value = String(todo.priority || 3);
    document.getElementById("todoNote").value = todo.note || "";
  } else {
    state.editingTodoId = null;
    form.reset();
    document.getElementById("todoPriority").value = "3";
  }
  document.getElementById("todoTitle").focus();
}

function closeTodoForm() {
  const form = document.getElementById("todoForm");
  form.reset();
  document.getElementById("todoPriority").value = "3";
  form.hidden = true;
  state.editingTodoId = null;
}

function openJournalForm(entry = null) {
  const form = document.getElementById("journalForm");
  form.hidden = false;
  const now = nowLondon();
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
  const now = nowLondon();
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
    const checkbox = node.querySelector(".todo-done");
    checkbox.checked = !!todo.done;
    checkbox.setAttribute("aria-label", todo.done ? "标记为未完成" : "标记为已完成");
    const titleEl = node.querySelector(".todo-title");
    titleEl.textContent = `${todo.order}. ${todo.title}`;
    titleEl.classList.toggle("done", todo.done);
    const metaEl = node.querySelector(".todo-meta");
    metaEl.innerHTML = "";
    const statusSpan = document.createElement("span");
    statusSpan.textContent = `优先级 ${todo.priority} · ${todo.done ? "已完成" : "未完成"}`;
    metaEl.appendChild(statusSpan);
    if (todo.note) {
      const noteSpan = document.createElement("span");
      noteSpan.textContent = todo.note;
      noteSpan.className = "note-text";
      noteSpan.title = todo.note;
      metaEl.appendChild(noteSpan);
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
        toggle.textContent = "展开全文";
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-controls", contentId);
        toggle.addEventListener("click", () => {
          const collapsed = contentEl.classList.toggle("collapsed");
          toggle.textContent = collapsed ? "展开全文" : "收起";
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
      timeSpan.textContent = `${entry.date} ${entry.time}`;
      metaEl.appendChild(timeSpan);
      const tagsSpan = document.createElement("span");
      tagsSpan.textContent = entry.tags?.length ? entry.tags.map((tag) => `#${tag}`).join(" ") : "无标签";
      metaEl.appendChild(tagsSpan);
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
      if (confirm("确定删除这条代办吗？")) {
        deleteTodo(id);
        showToast("代办已删除");
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
  const anchor = new Date(state.calendarAnchor + "T00:00:00");
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstWeekday = (firstDay.getUTCDay() + 6) % 7; // Monday first
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  label.textContent = `${year} 年 ${month + 1} 月`;

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
      cell.setAttribute("aria-label", `${date} 有记录`);
      cell.title = `${date} 有记录`;
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

  document.getElementById("globalSearch").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.target.value = "";
      event.target.dispatchEvent(new Event("input"));
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
    if (event.key.toLowerCase() === "n") {
      event.preventDefault();
      openTodoForm();
    }
    if (event.key.toLowerCase() === "j") {
      event.preventDefault();
      openJournalForm();
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

  document.getElementById("exportJournalTxt").addEventListener("click", exportJournalTxt);
  document.getElementById("exportTodosTxtRange").addEventListener("click", exportTodosTxtRange);

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
  closeTodoForm();
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
  closeJournalForm();
  showToast("日记已保存");
}

function exportJournalTxt() {
  const from = document.getElementById("journalExportFrom").value || state.selectedDate;
  const to = document.getElementById("journalExportTo").value || state.selectedDate;
  if (!from || !to) {
    showToast("请先选择导出日期范围");
    return;
  }
  if (from > to) {
    showToast("日期范围不正确");
    return;
  }
  const entries = state.journal
    .filter((entry) => entry.date >= from && entry.date <= to)
    .slice()
    .sort((a, b) => {
      if (a.date === b.date) return a.time.localeCompare(b.time);
      return a.date.localeCompare(b.date);
    });
  if (!entries.length) {
    showToast("所选范围无日记记录");
    return;
  }
  const lines = entries.map((entry) => {
    const tags = entry.tags?.length ? ` [${entry.tags.join(", ")}]` : "";
    return `${entry.date} ${entry.time}${tags}\n${entry.content}`;
  });
  const content = [`日记导出 (${from} ~ ${to})`, "", ...lines].join("\n\n");
  downloadFile(`journal_${from}_${to}.txt`, content, { mime: "text/plain;charset=utf-8", bom: true });
  showToast("日记已导出");
}

function exportTodosTxtRange() {
  const todos = filteredTodos()
    .slice()
    .sort((a, b) => {
      if (a.date === b.date) return a.order - b.order;
      return a.date.localeCompare(b.date);
    });
  if (!todos.length) {
    showToast("当前筛选无代办");
    return;
  }
  const lines = todos.map((todo) => {
    const status = todo.done ? "✔" : "○";
    const note = todo.note ? ` — ${todo.note}` : "";
    return `${todo.date} #${todo.order} [P${todo.priority}] ${status} ${todo.title}${note}`;
  });
  const content = ["代办导出 (当前筛选)", "", ...lines].join("\n");
  downloadFile(`todos_filtered.txt`, content, { mime: "text/plain;charset=utf-8", bom: true });
  showToast("代办已导出");
}

function exportBackup() {
  const payload = {
    version: 1,
    journal: state.journal,
    todos: state.todos,
  };
  downloadFile(
    `backup_${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify(payload, null, 2),
    { mime: "application/json", bom: false }
  );
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
    closeTodoForm();
    closeJournalForm();
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
  setupEventHandlers();
  const now = nowLondon();
  document.getElementById("journalDate").value = state.selectedDate || now.date;
  document.getElementById("journalTime").value = now.time;
  document.getElementById("selectedDateLabel").textContent = formatter.label(state.selectedDate);
  document.getElementById("filterDateFrom").value = state.selectedDate;
  document.getElementById("filterDateTo").value = state.selectedDate;
  document.getElementById("journalExportFrom").value = state.selectedDate;
  document.getElementById("journalExportTo").value = state.selectedDate;
  renderCalendar();
  renderTodos();
  renderJournal();
}

window.addEventListener("DOMContentLoaded", initialize);

// 自检：刷新后数据仍在；TXT 导出/JSON 备份保持顺序；日历选择同步；筛选搜索即时；键盘快捷键和焦点可用；拖拽/按钮排序立即保存。
