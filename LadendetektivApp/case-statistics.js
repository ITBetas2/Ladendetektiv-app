// Calendar boundaries use Europe/Zurich, independent of the viewer's device.
export const STATISTICS_TIME_ZONE = "Europe/Zurich";
const calendar = new Intl.DateTimeFormat("en-CA", {
  timeZone: STATISTICS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit"
});
const dateTime = new Intl.DateTimeFormat("de-CH", {
  timeZone: STATISTICS_TIME_ZONE, dateStyle: "medium", timeStyle: "short"
});
const units = ["day", "week", "month"];

export function swissDateKey(value = Date.now()) {
  const parts = Object.fromEntries(calendar.formatToParts(new Date(value)).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function calendarDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) throw new Error("Ungültiges Datum");
  const date = new Date(`${key}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== key) throw new Error("Ungültiges Datum");
  return date;
}
const keyOf = date => date.toISOString().slice(0, 10);
const shortDate = key => key.split("-").reverse().join(".");

export function periodBounds(unit, anchor) {
  if (!units.includes(unit)) throw new Error("Ungültiger Zeitraum");
  const start = calendarDate(anchor);
  if (unit === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (unit === "month") start.setUTCDate(1);
  const end = new Date(start);
  if (unit === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + (unit === "week" ? 7 : 1));
  return { start: keyOf(start), end: keyOf(end) }; // Inclusive start, exclusive end.
}

export function shiftPeriod(unit, anchor, amount) {
  const date = calendarDate(periodBounds(unit, anchor).start);
  if (unit === "month") date.setUTCMonth(date.getUTCMonth() + amount);
  else date.setUTCDate(date.getUTCDate() + amount * (unit === "week" ? 7 : 1));
  return keyOf(date);
}

export function periodLabel(unit, anchor) {
  const bounds = periodBounds(unit, anchor);
  if (unit === "month") return new Intl.DateTimeFormat("de-CH", { month: "long", year: "numeric", timeZone: "UTC" }).format(calendarDate(bounds.start));
  if (unit === "day") return shortDate(bounds.start);
  const last = calendarDate(bounds.end);
  last.setUTCDate(last.getUTCDate() - 1);
  return `${shortDate(bounds.start)} – ${shortDate(keyOf(last))}`;
}

export function caseTimestamp(entry) {
  const value = entry.occurredAt ?? entry.occurredAtMs;
  let ms;
  try {
    if (typeof value?.toMillis === "function") ms = value.toMillis();
    else if (value instanceof Date) ms = value.getTime();
    else if (typeof value === "number") ms = value;
    else if (typeof value === "string" && value.trim()) ms = Date.parse(value);
    else if (value && Number.isFinite(value.seconds)) ms = value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
  } catch (_) { return null; }
  return Number.isFinite(ms) && Math.abs(ms) <= 8640000000000000 ? ms : null;
}

export function employeeKey(entry) {
  const email = String(entry.reporterEmail || "").trim().toLowerCase();
  return entry.reporterUid ? `uid:${entry.reporterUid}` : email ? `email:${email}` : `name:${String(entry.reporterName || "Unbekannt").trim()}`;
}

export function buildStatistics(cases, { unit = "month", anchor = swissDateKey(), employee = "all" } = {}) {
  const bounds = periodBounds(unit, anchor);
  const employees = new Map();
  // Old records with an email but no UID belong to the same account when unambiguous.
  const emailUids = new Map();
  for (const entry of cases) {
    const email = String(entry.reporterEmail || "").trim().toLowerCase();
    if (!email || !entry.reporterUid) continue;
    if (!emailUids.has(email)) emailUids.set(email, new Set());
    emailUids.get(email).add(entry.reporterUid);
  }
  const rows = cases.map(entry => {
    const email = String(entry.reporterEmail || "").trim().toLowerCase();
    const matchingUids = emailUids.get(email);
    const key = !entry.reporterUid && matchingUids?.size === 1 ? `uid:${[...matchingUids][0]}` : employeeKey(entry);
    const ms = caseTimestamp(entry);
    const row = { ...entry, employeeKey: key, ms, dateKey: ms === null ? null : swissDateKey(ms) };
    if (!employees.has(key)) employees.set(key, { key, name: entry.reporterName || email || "Unbekannt", email, count: 0 });
    return row;
  });
  const selected = rows.filter(r => r.dateKey && r.dateKey >= bounds.start && r.dateKey < bounds.end);
  for (const row of selected) employees.get(row.employeeKey).count++;
  const totals = Object.fromEntries(units.map(key => {
    const range = periodBounds(key, anchor);
    return [key, rows.filter(r => r.dateKey && r.dateKey >= range.start && r.dateKey < range.end).length];
  }));
  const history = [];
  const count = unit === "day" ? 14 : 12;
  const buckets = new Map();
  for (const row of rows) {
    if (!row.dateKey) continue;
    const key = periodBounds(unit, row.dateKey).start;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  for (let offset = 1 - count; offset <= 0; offset++) {
    const start = shiftPeriod(unit, anchor, offset);
    history.push({ start, label: periodLabel(unit, start), count: buckets.get(start) || 0 });
  }
  return {
    bounds, totals, history, total: selected.length,
    employees: [...employees.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "de-CH") || a.key.localeCompare(b.key)),
    rows: selected.filter(r => employee === "all" || r.employeeKey === employee).sort((a, b) => b.ms - a.ms || String(a.id).localeCompare(String(b.id))),
    undated: rows.filter(r => !r.dateKey).length
  };
}

export function canViewStatistics(state, admin = false) {
  return !!(state.session?.uid && state.role?.canUseCases !== false && (admin || state.roleName === "Leitung"));
}

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function installCaseStatistics({ getState, isAdmin, renderCases, renderRanking, document: doc = document }) {
  const panel = doc.getElementById("caseSubStatistics");
  const button = doc.getElementById("caseTabStatistics");
  const filters = { unit: "month", anchor: swissDateKey(), employee: "all" };
  let active = "cases";
  let mounted = false;
  const allowed = () => canViewStatistics(getState(), isAdmin());

  function activate(tab) {
    active = tab === "statistics" && allowed() ? tab : tab === "ranking" ? tab : "cases";
    getState().caseSubTab = active;
    try { doc.defaultView.localStorage.setItem("tas_case_subtab_v1", active); } catch (_) { /* Storage may be disabled. */ }
    for (const [key, suffix] of [["cases", "Cases"], ["ranking", "Ranking"], ["statistics", "Statistics"]]) {
      const current = active === key;
      const tabButton = doc.getElementById(`caseTab${suffix}`);
      const view = doc.getElementById(`caseSub${suffix}`);
      tabButton?.classList.toggle("active", current);
      tabButton?.setAttribute("aria-selected", String(current));
      if (view) {
        view.classList.toggle("isShown", current);
        view.classList.toggle("isHidden", !current);
        view.hidden = !current;
        view.style.display = current ? "" : "none";
      }
    }
    if (active === "statistics") refresh();
    else if (active === "ranking") renderRanking();
    else renderCases();
  }

  function mount() {
    panel.innerHTML = `
      <div class="section case-statistics">
        <div class="cs-heading"><div><h3>Fallstatistik</h3><p>Gesamtübersicht und Fälle pro Mitarbeiter</p></div><span class="chip">Leitung</span></div>
        <p class="hint">Gezählt wird das Falldatum in Schweizer Zeit. Wochen laufen von Montag bis Sonntag.</p>
        <div class="cs-filters">
          <label>Ansicht<select id="csUnit"><option value="day">Tag</option><option value="week">Woche</option><option value="month" selected>Monat</option></select></label>
          <label>Datum im Zeitraum<input id="csAnchor" type="date" value="${filters.anchor}" required></label>
          <label>Mitarbeiter<select id="csEmployee"><option value="all">Alle Mitarbeiter</option></select></label>
        </div>
        <div class="cs-navigation"><button class="btn small" id="csPrevious" type="button" aria-label="Vorheriger Zeitraum">← Zurück</button><button class="btn small" id="csToday" type="button">Heute</button><button class="btn small" id="csNext" type="button" aria-label="Nächster Zeitraum">Weiter →</button></div>
        <p id="csStatus" class="hint" role="status" aria-live="polite"></p>
        <div id="csResults">
          <div class="cs-totals" id="csTotals"></div>
          <p class="hint">Die Gesamtzahlen und der Gesamtverlauf umfassen immer alle Mitarbeiter.</p>
          <h4 id="csHistoryTitle">Gesamtverlauf</h4><div class="cs-history" id="csHistory"></div>
          <div class="cs-heading"><h4 id="csPeriod"></h4><span id="csPeriodTotal" class="chip"></span></div>
          <h4>Auswertung pro Mitarbeiter</h4><p class="hint">Alle Mitarbeiter mit erfassten Fällen; auch mit 0 Fällen im gewählten Zeitraum. Klicke auf einen Mitarbeiter, um seine Fälle zu sehen.</p>
          <div class="cs-table-scroll"><table><caption class="cs-sr-only">Anzahl Fälle pro Mitarbeiter im gewählten Zeitraum</caption><thead><tr><th scope="col">Mitarbeiter</th><th scope="col">Konto</th><th scope="col">Fälle</th></tr></thead><tbody id="csEmployees"></tbody></table></div>
          <div class="cs-heading"><h4>Einzelne Fälle</h4><span id="csCount" class="chip"></span></div>
          <div class="cs-table-scroll"><table><caption class="cs-sr-only">Einzelne Fälle im gewählten Zeitraum und Mitarbeiterfilter</caption><thead><tr><th scope="col">Falldatum / Zeit</th><th scope="col">Mitarbeiter</th><th scope="col">Ort</th><th scope="col">Fall-ID</th></tr></thead><tbody id="csCases"></tbody></table></div>
        </div>
      </div>`;
    doc.getElementById("csUnit").value = filters.unit;
    doc.getElementById("csUnit").addEventListener("change", event => { filters.unit = event.target.value; refresh(); });
    doc.getElementById("csAnchor").addEventListener("change", event => {
      try { calendarDate(event.target.value); filters.anchor = event.target.value; refresh(); }
      catch (_) { event.target.value = filters.anchor; }
    });
    doc.getElementById("csEmployee").addEventListener("change", event => { filters.employee = event.target.value; refresh(); });
    for (const [id, offset] of [["csPrevious", -1], ["csNext", 1], ["csToday", 0]]) {
      doc.getElementById(id).addEventListener("click", () => {
        filters.anchor = offset ? shiftPeriod(filters.unit, filters.anchor, offset) : swissDateKey();
        refresh();
      });
    }
    mounted = true;
  }

  function refresh() {
    const authorized = allowed();
    button.hidden = !authorized;
    button.classList.toggle("hidden", !authorized);
    if (!authorized) {
      panel.replaceChildren();
      mounted = false;
      filters.employee = "all";
      if (active === "statistics") activate("cases");
      return;
    }
    if (!mounted) mount();
    const state = getState();
    const status = state.casesStatus || "loading";
    doc.getElementById("csResults").hidden = status !== "ready";
    doc.getElementById("csStatus").textContent = status === "error" ? "Fälle konnten nicht geladen werden. Bitte die Verbindung und Zugriffsrechte prüfen und die Seite neu laden." : status === "ready" ? "" : "Fälle werden geladen …";
    if (status !== "ready") return;
    let model = buildStatistics(state.cases || [], filters);
    if (filters.employee !== "all" && !model.employees.some(e => e.key === filters.employee)) {
      filters.employee = "all";
      model = buildStatistics(state.cases || [], filters);
    }
    doc.getElementById("csAnchor").value = filters.anchor;
    const select = doc.getElementById("csEmployee");
    select.innerHTML = '<option value="all">Alle Mitarbeiter</option>' + model.employees.map(e => `<option value="${escape(e.key)}">${escape(e.name)}${e.email ? ` (${escape(e.email)})` : ""}</option>`).join("");
    select.value = filters.employee;
    doc.getElementById("csStatus").textContent = model.undated ? `${model.undated} Fälle ohne gültiges Falldatum können keinem Zeitraum zugeordnet werden.` : "";
    doc.getElementById("csTotals").innerHTML = units.map((unit, i) => `<button type="button" class="cs-total${filters.unit === unit ? " is-selected" : ""}" data-unit="${unit}" aria-pressed="${filters.unit === unit}"><span>Gesamt ${["Tag", "Woche", "Monat"][i]}</span><strong>${model.totals[unit]}</strong><small>${escape(periodLabel(unit, filters.anchor))}</small></button>`).join("");
    doc.getElementById("csTotals").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { filters.unit = b.dataset.unit; doc.getElementById("csUnit").value = filters.unit; refresh(); }));
    doc.getElementById("csHistoryTitle").textContent = `Gesamtverlauf · ${filters.unit === "day" ? "14 Tage" : filters.unit === "week" ? "12 Wochen" : "12 Monate"}`;
    const max = Math.max(1, ...model.history.map(b => b.count));
    doc.getElementById("csHistory").innerHTML = model.history.map(b => `<button type="button" class="cs-history-row${b.start === model.bounds.start ? " is-selected" : ""}" data-date="${b.start}" aria-label="${escape(b.label)}: ${b.count} Fälle anzeigen"><span>${escape(b.label)}</span><span class="cs-bar" aria-hidden="true"><i style="width:${b.count / max * 100}%"></i></span><strong>${b.count}</strong></button>`).join("");
    doc.getElementById("csHistory").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { filters.anchor = b.dataset.date; refresh(); }));
    doc.getElementById("csPeriod").textContent = periodLabel(filters.unit, filters.anchor);
    doc.getElementById("csPeriodTotal").textContent = `${model.total} Fälle gesamt`;
    doc.getElementById("csEmployees").innerHTML = model.employees.map(e => `<tr${filters.employee === e.key ? ' class="is-selected"' : ""}><td><button class="cs-employee" type="button" data-employee="${escape(e.key)}">${escape(e.name)}</button></td><td>${escape(e.email || e.key.replace(/^[^:]+:/, ""))}</td><td><strong>${e.count}</strong></td></tr>`).join("") || '<tr><td colspan="3">Noch keine Mitarbeiter mit erfassten Fällen.</td></tr>';
    doc.getElementById("csEmployees").querySelectorAll("button").forEach(b => b.addEventListener("click", () => { filters.employee = b.dataset.employee; refresh(); }));
    doc.getElementById("csCount").textContent = `${model.rows.length} Fälle angezeigt`;
    doc.getElementById("csCases").innerHTML = model.rows.map(r => `<tr><td>${escape(dateTime.format(new Date(r.ms)))}</td><td>${escape(r.reporterName || "Unbekannt")}<small>${escape(r.reporterEmail || "")}</small></td><td>${escape(r.place || "—")}</td><td class="cs-case-id">${escape(r.id || "—")}</td></tr>`).join("") || '<tr><td colspan="4">Keine Fälle für diesen Zeitraum und Mitarbeiter.</td></tr>';
  }

  for (const [tab, suffix] of [["cases", "Cases"], ["ranking", "Ranking"], ["statistics", "Statistics"]]) {
    const tabButton = doc.getElementById(`caseTab${suffix}`);
    tabButton?.setAttribute("role", "tab");
    tabButton?.setAttribute("aria-controls", `caseSub${suffix}`);
    doc.getElementById(`caseSub${suffix}`)?.setAttribute("role", "tabpanel");
    doc.getElementById(`caseSub${suffix}`)?.setAttribute("aria-labelledby", `caseTab${suffix}`);
    tabButton?.addEventListener("click", () => activate(tab));
  }
  doc.getElementById("caseSubtabBar")?.setAttribute("role", "tablist");
  // One controller replaces the three conflicting legacy tab implementations.
  doc.defaultView.setCaseSubTab = activate;
  let initialTab = "cases";
  try { if (doc.defaultView.localStorage.getItem("tas_case_subtab_v1") === "ranking") initialTab = "ranking"; } catch (_) { /* Storage may be disabled. */ }
  activate(initialTab);
  refresh();
  return { refresh, activate };
}
