/* ───────────────────────────────────────────────────────────────
   Demandas — app.js
   Front-end puro (sem build). Usa Supabase para dados + realtime,
   Web Speech API para voz, e uma Edge Function ("parse-demand")
   para a IA estruturar a fala. Tudo comentado em português.
   ─────────────────────────────────────────────────────────────── */

(function () {
  "use strict";

  // ── Config ────────────────────────────────────────────────────
  const cfg = window.APP_CONFIG || {};
  const hasConfig =
    cfg.SUPABASE_URL &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_URL.includes("COLE_AQUI");
  const BOARD = (cfg.BOARD || "geral").trim() || "geral";

  const DEFAULT_CATEGORIES = ["Pessoal", "Trabalho", "Financeiro", "Mercado", "Farmácia", "Casa", "Carro", "Gatos", "Geral"];

  // ── Estado ────────────────────────────────────────────────────
  let supabase = null;
  let demands = [];
  let filterStatus = "abertas";
  let filterCategory = "";
  let filterAuthor = "";
  let searchTerm = "";
  let editingId = null;
  let editPriority = "";
  let quickPriority = ""; // "", "baixa", "media", "alta"

  // Nome de quem está usando (para o campo "author"). Fica só no navegador.
  let authorName = safeGet("demandas.author") || "";

  // ── Elementos ─────────────────────────────────────────────────
  const $ = (s) => document.querySelector(s);
  const listEl = $("#list");
  const emptyEl = $("#empty");
  const setupWarnEl = $("#setup-warning");
  const quickInput = $("#quick-input");
  const quickCategory = $("#quick-category");
  const filterCategoryEl = $("#filter-category");
  const filterAuthorEl = $("#filter-author");
  const micBtn = $("#mic-btn");
  const micHint = $("#mic-hint");
  const connStatus = $("#conn-status");
  const countEl = $("#count");

  // ── Boot ──────────────────────────────────────────────────────
  init();

  function init() {
    document.documentElement.setAttribute(
      "data-theme",
      safeGet("demandas.theme") || "light"
    );
    updateThemeBtn();
    $("#board-label").textContent = "Quadro: " + BOARD;
    renderCategoryOptions();
    renderMeName();
    wireEvents();

    if (!hasConfig) {
      showSetupWarning();
      return;
    }

    supabase = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    loadDemands();
    subscribeRealtime();
  }

  // ── Carregar / Realtime ───────────────────────────────────────
  async function loadDemands() {
    setConn(null);
    const { data, error } = await supabase
      .from("demands")
      .select("*")
      .eq("board", BOARD)
      .order("created_at", { ascending: false });
    if (error) {
      console.error(error);
      toast("Erro ao carregar. Confira o SUPABASE_URL/anon key e o schema.");
      setConn(false);
      return;
    }
    demands = data || [];
    render();
    renderCategoryOptions();
    setConn(true);
  }

  function subscribeRealtime() {
    supabase
      .channel("demands-" + BOARD)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "demands", filter: "board=eq." + BOARD },
        (payload) => {
          const { eventType, new: row, old } = payload;
          if (eventType === "INSERT") {
            if (!demands.some((d) => d.id === row.id)) demands.unshift(row);
          } else if (eventType === "UPDATE") {
            demands = demands.map((d) => (d.id === row.id ? row : d));
          } else if (eventType === "DELETE") {
            demands = demands.filter((d) => d.id !== old.id);
          }
          render();
          renderCategoryOptions();
        }
      )
      .subscribe((status) => setConn(status === "SUBSCRIBED"));
  }

  // ── Criar / Atualizar / Apagar ────────────────────────────────
  async function addDemand({ title, notes = null, category, priority }) {
    title = (title || "").trim();
    if (!title) return;
    if (!supabase) { showSetupWarning(); return; }

    ensureAuthor();
    const row = {
      board: BOARD,
      title,
      notes: notes && notes.trim() ? notes.trim() : null,
      category: category || quickCategory.value || "Geral",
      priority: priority || null,
      author: authorName || null,
    };
    // Otimista: mostra na hora
    const temp = { ...row, id: "tmp-" + Date.now(), status: "aberta", created_at: new Date().toISOString() };
    demands.unshift(temp);
    render();

    const { data, error } = await supabase.from("demands").insert(row).select().single();
    if (error) {
      console.error(error);
      demands = demands.filter((d) => d.id !== temp.id);
      render();
      toast("Não deu pra salvar. Veja o console (F12).");
      return;
    }
    // Substitui o temporário pelo real
    demands = demands.map((d) => (d.id === temp.id ? data : d));
    render();
    renderCategoryOptions();
  }

  async function toggleDone(id, done) {
    demands = demands.map((d) => (d.id === id ? { ...d, status: done ? "concluida" : "aberta" } : d));
    render();
    if (String(id).startsWith("tmp-") || !supabase) return;
    const { error } = await supabase
      .from("demands")
      .update({ status: done ? "concluida" : "aberta" })
      .eq("id", id);
    if (error) { console.error(error); toast("Erro ao atualizar."); }
  }

  async function removeDemand(id) {
    const backup = demands;
    demands = demands.filter((d) => d.id !== id);
    render();
    if (String(id).startsWith("tmp-") || !supabase) return;
    const { error } = await supabase.from("demands").delete().eq("id", id);
    if (error) { console.error(error); demands = backup; render(); toast("Erro ao apagar."); }
  }

  async function updateField(id, patch) {
    demands = demands.map((d) => (d.id === id ? { ...d, ...patch } : d));
    render();
    if (String(id).startsWith("tmp-") || !supabase) return;
    const { error } = await supabase.from("demands").update(patch).eq("id", id);
    if (error) { console.error(error); toast("Erro ao editar."); }
  }

  // ── Voz + IA ──────────────────────────────────────────────────
  let recognition = null;
  let recognizing = false;

  function setupSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.lang = "pt-BR";
    r.interimResults = true;
    r.continuous = false;
    return r;
  }

  function toggleMic() {
    if (!("SpeechRecognition" in window) && !("webkitSpeechRecognition" in window)) {
      hint("Seu navegador não suporta reconhecimento de voz. Use o Chrome no computador ou digite.", true);
      return;
    }
    if (recognizing) { try { recognition.stop(); } catch (e) {} return; }

    recognition = setupSpeech();
    if (!recognition) return;
    let finalText = "";

    recognition.onstart = () => {
      recognizing = true;
      micBtn.classList.add("rec");
      hint("🎙️ Ouvindo… fale a demanda. Toque de novo para parar.");
    };
    recognition.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const t = ev.results[i][0].transcript;
        if (ev.results[i].isFinal) finalText += t;
        else interim += t;
      }
      quickInput.value = (finalText + interim).trim();
    };
    recognition.onerror = (ev) => {
      hint("Erro no microfone: " + ev.error + ". Verifique a permissão de microfone.", true);
    };
    recognition.onend = async () => {
      recognizing = false;
      micBtn.classList.remove("rec");
      const text = (finalText || quickInput.value || "").trim();
      if (!text) { hint("Não captei nada. Tente de novo."); return; }
      await handleSpokenText(text);
    };

    try { recognition.start(); }
    catch (e) { hint("Não consegui iniciar o microfone.", true); }
  }

  // Pega o texto falado, tenta estruturar com a IA (Edge Function).
  // Se a IA não estiver configurada, cai num parser local simples.
  async function handleSpokenText(text) {
    hint("🤖 Estruturando com a IA…");
    let parsed = null;
    if (supabase) {
      try {
        const { data, error } = await supabase.functions.invoke("parse-demand", {
          body: { text, categories: currentCategories() },
        });
        if (!error && data && data.title) parsed = data;
      } catch (e) { console.warn("IA indisponível, usando parser local.", e); }
    }
    if (!parsed) parsed = localParse(text);

    // Preenche os campos com a sugestão e já salva.
    quickInput.value = parsed.title;
    if (parsed.category) setQuickCategory(parsed.category);
    if (parsed.priority) setQuickPriority(parsed.priority);

    await addDemand({
      title: parsed.title,
      notes: parsed.notes || null,
      category: parsed.category,
      priority: parsed.priority,
    });
    resetCapture();
    hint("✅ Demanda criada" + (parsed.priority ? " (prioridade " + parsed.priority + ")" : "") + ".");
    setTimeout(() => hint(""), 3500);
  }

  // Parser local de reserva (sem IA): detecta prioridade e categoria por palavras.
  function localParse(text) {
    const t = text.toLowerCase();
    let priority = null;
    if (/\b(urgente|urgent[ií]ssim|agora|imediat|prioridade alta|cr[ií]tico)\b/.test(t)) priority = "alta";
    else if (/\b(quando puder|sem pressa|baixa prioridade|depois)\b/.test(t)) priority = "baixa";
    else if (/\b(prioridade m[eé]dia|m[eé]dia)\b/.test(t)) priority = "media";

    let category = "Geral";
    for (const c of currentCategories()) {
      if (t.includes(c.toLowerCase())) { category = c; break; }
    }
    if (category === "Geral") {
      if (/\b(pagar|conta|boleto|nota|fatura|dinheiro|or[çc]amento)\b/.test(t)) category = "Financeiro";
      else if (/\b(reuni[ãa]o|cliente|projeto|relat[óo]rio|trabalho|email|e-mail)\b/.test(t)) category = "Trabalho";
    }
    // Título limpo (remove menções óbvias de prioridade)
    const title = text.replace(/\b(urgente|urgent[ií]ssimo|prioridade (alta|m[eé]dia|baixa))\b/gi, "").trim() || text;
    return { title, category, priority, notes: null };
  }

  // ── Categorias ────────────────────────────────────────────────
  function currentCategories() {
    const set = new Set(DEFAULT_CATEGORIES);
    demands.forEach((d) => d.category && set.add(d.category));
    (safeGet("demandas.customCats") || "").split(",").forEach((c) => c.trim() && set.add(c.trim()));
    return Array.from(set);
  }

  function renderCategoryOptions() {
    const cats = currentCategories();
    // Select de captura
    const cur = quickCategory.value;
    quickCategory.innerHTML =
      cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("") +
      `<option value="__new__">➕ Nova categoria…</option>`;
    if (cats.includes(cur)) quickCategory.value = cur;
    // Filtro
    const curF = filterCategoryEl.value;
    filterCategoryEl.innerHTML =
      `<option value="">Todas as categorias</option>` +
      cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    filterCategoryEl.value = curF;
  }

  function setQuickCategory(name) {
    if (!currentCategories().includes(name)) {
      const custom = (safeGet("demandas.customCats") || "").split(",").map((s) => s.trim()).filter(Boolean);
      custom.push(name);
      safeSet("demandas.customCats", custom.join(","));
      renderCategoryOptions();
    }
    quickCategory.value = name;
  }

  // ── Filtro por pessoa ─────────────────────────────────────────
  function renderAuthorOptions() {
    const authors = Array.from(new Set(demands.map((d) => d.author).filter(Boolean))).sort();
    const cur = filterAuthorEl.value;
    filterAuthorEl.innerHTML =
      `<option value="">Todas as pessoas</option>` +
      authors.map((a) => `<option value="${esc(a)}">👤 ${esc(a)}</option>`).join("");
    if (authors.includes(cur)) filterAuthorEl.value = cur;
  }

  // ── Nome de quem está usando ──────────────────────────────────
  function renderMeName() {
    $("#me-name").textContent = authorName || "Seu nome";
  }
  function changeMyName() {
    const n = prompt("Seu nome (aparece nas demandas que você criar):", authorName || "");
    if (n === null) return;
    authorName = n.trim();
    safeSet("demandas.author", authorName);
    renderMeName();
  }

  // ── Editar demanda (telinha) ──────────────────────────────────
  function openEdit(id) {
    const d = demands.find((x) => x.id === id);
    if (!d) return;
    editingId = id;
    $("#edit-title").value = d.title || "";
    $("#edit-notes").value = d.notes || "";
    // categorias no select do modal
    const cats = currentCategories();
    const sel = $("#edit-category");
    sel.innerHTML = cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    if (!cats.includes(d.category)) {
      sel.innerHTML += `<option value="${esc(d.category)}">${esc(d.category)}</option>`;
    }
    sel.value = d.category || "Geral";
    setEditPriority(d.priority || "");
    $("#edit-overlay").hidden = false;
    setTimeout(() => $("#edit-title").focus(), 30);
  }
  function closeEdit() { editingId = null; $("#edit-overlay").hidden = true; }
  function setEditPriority(p) {
    editPriority = p || "";
    document.querySelectorAll("#edit-prio .prio").forEach((b) =>
      b.setAttribute("data-active", (b.dataset.prio || "") === editPriority ? "true" : "false")
    );
  }
  function saveEdit() {
    if (!editingId) return;
    const title = $("#edit-title").value.trim();
    if (!title) { $("#edit-title").focus(); return; }
    const notes = $("#edit-notes").value.trim();
    updateField(editingId, {
      title,
      notes: notes || null,
      category: $("#edit-category").value || "Geral",
      priority: editPriority || null,
    });
    closeEdit();
  }

  // ── Prioridade (botões) ───────────────────────────────────────
  function setQuickPriority(p) {
    quickPriority = p || "";
    document.querySelectorAll(".prio").forEach((b) =>
      b.setAttribute("data-active", (b.dataset.prio || "") === quickPriority ? "true" : "false")
    );
  }

  // ── Render ────────────────────────────────────────────────────
  function render() {
    const items = demands.filter((d) => {
      if (filterStatus === "abertas" && d.status !== "aberta") return false;
      if (filterStatus === "concluidas" && d.status !== "concluida") return false;
      if (filterCategory && d.category !== filterCategory) return false;
      if (filterAuthor && (d.author || "") !== filterAuthor) return false;
      if (searchTerm) {
        const hay = (d.title + " " + (d.notes || "") + " " + d.category).toLowerCase();
        if (!hay.includes(searchTerm)) return false;
      }
      return true;
    });

    // Ordena: prioridade alta primeiro dentro das abertas, senão por data
    const rank = { alta: 0, media: 1, baixa: 2, null: 3, "": 3, undefined: 3 };
    items.sort((a, b) => {
      const ra = rank[a.priority] ?? 3, rb = rank[b.priority] ?? 3;
      if (ra !== rb) return ra - rb;
      return new Date(b.created_at) - new Date(a.created_at);
    });

    renderAuthorOptions();
    listEl.innerHTML = items.map(cardHTML).join("");
    emptyEl.hidden = items.length !== 0 || !hasConfig;
    const abertas = demands.filter((d) => d.status === "aberta").length;
    countEl.textContent = `${abertas} aberta(s) • ${demands.length} no total`;
  }

  function cardHTML(d) {
    const done = d.status === "concluida";
    const prio = d.priority || "";
    const prioTag = prio ? `<span class="tag prio ${prio}">${prioLabel(prio)}</span>` : "";
    const authorTag = d.author ? `<span class="tag author">👤 ${esc(d.author)}</span>` : "";
    const notes = d.notes ? `<div class="card-notes">${esc(d.notes)}</div>` : "";
    return `
      <li class="card ${done ? "done" : ""}" data-prio="${prio}" data-id="${d.id}">
        <input type="checkbox" class="check" ${done ? "checked" : ""} data-action="toggle" aria-label="Concluir" />
        <div class="card-body">
          <div class="card-title" data-action="edit-title" title="Clique para editar">${esc(d.title)}</div>
          ${notes}
          <div class="card-tags">
            <span class="tag">🏷️ ${esc(d.category || "Geral")}</span>
            ${prioTag}
            ${authorTag}
            <span class="tag">${timeAgo(d.created_at)}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="mini-btn" data-action="edit" title="Editar">✏️</button>
          <button class="mini-btn" data-action="delete" title="Apagar">🗑️</button>
        </div>
      </li>`;
  }

  // ── Eventos ───────────────────────────────────────────────────
  function wireEvents() {
    $("#add-btn").addEventListener("click", submitQuick);
    quickInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitQuick(); });
    micBtn.addEventListener("click", toggleMic);

    quickCategory.addEventListener("change", () => {
      if (quickCategory.value === "__new__") {
        const name = prompt("Nome da nova categoria:");
        if (name && name.trim()) { setQuickCategory(name.trim()); }
        else { quickCategory.value = "Geral"; }
      }
    });

    document.querySelectorAll(".prio").forEach((b) =>
      b.addEventListener("click", () => setQuickPriority(b.dataset.prio || ""))
    );

    $("#filter-status").addEventListener("click", (e) => {
      const btn = e.target.closest(".chip"); if (!btn) return;
      filterStatus = btn.dataset.status;
      document.querySelectorAll("#filter-status .chip").forEach((c) =>
        c.setAttribute("data-active", c === btn ? "true" : "false")
      );
      render();
    });
    filterCategoryEl.addEventListener("change", () => { filterCategory = filterCategoryEl.value; render(); });
    filterAuthorEl.addEventListener("change", () => { filterAuthor = filterAuthorEl.value; render(); });
    $("#filter-search").addEventListener("input", (e) => { searchTerm = e.target.value.trim().toLowerCase(); render(); });

    // Nome do usuário
    $("#me-btn").addEventListener("click", changeMyName);

    // Telinha de edição
    $("#edit-save").addEventListener("click", saveEdit);
    $("#edit-cancel").addEventListener("click", closeEdit);
    $("#edit-overlay").addEventListener("click", (e) => { if (e.target.id === "edit-overlay") closeEdit(); });
    document.querySelectorAll("#edit-prio .prio").forEach((b) =>
      b.addEventListener("click", () => setEditPriority(b.dataset.prio || ""))
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#edit-overlay").hidden) closeEdit();
    });

    // Delegação de cliques na lista
    listEl.addEventListener("click", (e) => {
      const li = e.target.closest(".card"); if (!li) return;
      const id = li.dataset.id;
      const action = e.target.dataset.action;
      if (action === "toggle") toggleDone(id, e.target.checked);
      else if (action === "delete") { if (confirm("Apagar esta demanda?")) removeDemand(id); }
      else if (action === "edit" || action === "edit-title") openEdit(id);
    });

    $("#theme-btn").addEventListener("click", toggleTheme);
    $("#export-btn").addEventListener("click", exportJSON);
  }

  function submitQuick() {
    const title = quickInput.value.trim();
    if (!title) { quickInput.focus(); return; }
    addDemand({ title, category: quickCategory.value, priority: quickPriority });
    resetCapture();
  }

  function resetCapture() {
    quickInput.value = "";
    setQuickPriority("");
    quickInput.focus();
  }

  // ── Helpers ───────────────────────────────────────────────────
  function ensureAuthor() {
    if (authorName) return;
    const n = prompt("Seu nome (aparece nas demandas que você criar). Opcional:");
    if (n && n.trim()) { authorName = n.trim(); safeSet("demandas.author", authorName); }
    else authorName = ""; // segue sem nome
    renderMeName();
  }

  function exportJSON() {
    const blob = new Blob([JSON.stringify(demands, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `demandas-${BOARD}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function toggleTheme() {
    const cur = document.documentElement.getAttribute("data-theme");
    const next = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    safeSet("demandas.theme", next);
    updateThemeBtn();
  }
  function updateThemeBtn() {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    $("#theme-btn").textContent = dark ? "☀️" : "🌙";
  }

  function setConn(on) {
    if (!connStatus) return; // indicador removido do cabeçalho
    if (on === null) { connStatus.textContent = "conectando…"; connStatus.removeAttribute("data-on"); return; }
    connStatus.textContent = on ? "ao vivo" : "offline";
    connStatus.setAttribute("data-on", on ? "true" : "false");
  }

  function showSetupWarning() {
    setupWarnEl.hidden = false;
    setupWarnEl.innerHTML =
      "⚙️ <b>Falta configurar.</b> Copie <code>config.example.js</code> para <code>config.js</code> " +
      "e preencha <code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code>. " +
      "Passo a passo no <b>README.md</b>.";
    emptyEl.hidden = true;
    setConn(false);
  }

  function hint(msg, isErr) {
    micHint.hidden = !msg;
    micHint.textContent = msg || "";
    micHint.classList.toggle("err", !!isErr);
  }

  let toastT;
  function toast(msg) {
    let el = document.querySelector(".toast");
    if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
    el.textContent = msg;
    clearTimeout(toastT);
    toastT = setTimeout(() => el.remove(), 3500);
  }

  function prioLabel(p) { return { alta: "🔴 Alta", media: "🟠 Média", baixa: "🟢 Baixa" }[p] || p; }
  function timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (s < 60) return "agora";
    if (s < 3600) return Math.floor(s / 60) + " min";
    if (s < 86400) return Math.floor(s / 3600) + " h";
    return new Date(iso).toLocaleDateString("pt-BR");
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
})();
