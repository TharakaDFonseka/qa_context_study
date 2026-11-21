(function () {
  "use strict";

  const STORE = "cogqa_state_v1";
  const BY_ID = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));
  const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const LOCAL_MODE = !APPS_SCRIPT_URL;
  const app = document.getElementById("app");

  if (new URLSearchParams(location.search).has("reset")) localStorage.removeItem(STORE);
  let state = JSON.parse(localStorage.getItem(STORE) || "null") || { stage: "intro" };
  let shownAt = null;

  function save() { localStorage.setItem(STORE, JSON.stringify(state)); }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? "" : v);
    });
    children.flat().forEach(c => node.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return node;
  }

  function show(...nodes) { app.replaceChildren(...nodes); window.scrollTo(0, 0); }

  // ---------- Intro ----------
  function renderIntro(error) {
    const name = el("input", { type: "text", id: "name", maxlength: "100", placeholder: "e.g., John Doe", value: state.name || "" });
    const start = el("button", { onclick: begin }, "Begin");
    function begin() {
      const value = name.value.trim();
      if (!value) { name.focus(); return; }
      state.name = value;
      start.disabled = true;
      start.textContent = "Preparing your questions…";
      assign().then(res => {
        Object.assign(state, {
          participant_id: res.participant_id, pair_id: res.pair_id, pair_role: res.pair_role,
          assignment: res.assignment, phase: "main", index: 0, answers: { main: {}, extra: {} },
          submitted: {}, stage: "question",
        });
        save();
        render();
      }).catch(() => renderIntro("Could not load the questionnaire. Please check your connection and try again."));
    }
    show(
      el("h1", {}, "Question Answering Study"),
      el("h2", {}, "Welcome!"),
      el("p", {}, "Thank you for your interest in this study. This questionnaire is part of a class project (COS 597B) that examines how people use background information when answering questions."),
      el("p", {}, "You will be shown a series of short questions. Some questions include a context passage and others do not. Please answer each question based on your own knowledge and judgment, and do not search online. The main set takes approximately 20\u201330 minutes."),
      el("p", {}, el("strong", {}, "Please do not use AI tools (such as ChatGPT, Gemini, or Claude)."), " The purpose of this experiment is to compare how people and language models use context, so your answers must reflect human judgment only."),
      el("p", {}, "Participation is voluntary, and you may stop at any time. Your responses will be used solely for this class project and will not be shared or used for any other purpose."),
      el("h2", {}, "Your name"),
      el("p", { class: "muted" }, "Please enter your first name, or a pseudonym such as \u201cJohn Doe\u201d if you prefer to remain anonymous."),
      name,
      el("div", { class: "nav", style: "justify-content:flex-end;margin-top:18px" }, start),
      error ? el("p", { class: "error" }, error) : "",
      LOCAL_MODE ? el("p", { class: "muted" }, "Local test mode: answers will not be saved.") : "",
    );
    name.addEventListener("keydown", e => { if (e.key === "Enter") begin(); });
  }

  // ---------- Questions ----------
  function items() { return state.assignment[state.phase]; }
  function answers() { return state.answers[state.phase]; }

  function stopClock() {
    if (shownAt == null) return;
    const item = items()[state.index];
    const a = answers()[item.qid] || (answers()[item.qid] = { response: "" });
    a.time_ms = (a.time_ms || 0) + (Date.now() - shownAt);
    shownAt = null;
    save();
  }

  function renderQuestion() {
    const list = items();
    const item = list[state.index];
    const q = BY_ID[item.qid];
    const withCtx = item.condition === "with_context";
    const current = answers()[item.qid] || { response: "" };
    const next = el("button", {}, state.index === list.length - 1 ? "Finish" : "Next");
    const back = el("button", { class: "secondary", disabled: state.index === 0 }, "Back");

    function setResponse(value) {
      const a = answers()[item.qid] || (answers()[item.qid] = {});
      a.response = value;
      save();
      next.disabled = !String(value).trim();
    }

    let body;
    if (q.type === "short") {
      const box = el("textarea", { placeholder: "Your short answer" });
      const idk = el("input", { type: "checkbox", id: "idk" });
      const isIdk = current.response === "I don't know";
      box.value = isIdk ? "" : current.response;
      box.disabled = isIdk;
      idk.checked = isIdk;
      box.addEventListener("input", () => setResponse(box.value));
      idk.addEventListener("change", () => {
        box.disabled = idk.checked;
        setResponse(idk.checked ? "I don't know" : box.value);
      });
      body = el("div", {}, box, el("label", { class: "idk", for: "idk" }, idk, "I don't know"));
    } else {
      const labels = q.type === "yesno" ? ["Yes", "No"] : q.choices.map((_, i) => LETTERS[i]);
      const texts = q.type === "yesno" ? ["Yes", "No"] : q.choices;
      const opts = labels.map((label, i) => {
        const input = el("input", { type: "radio", name: "opt", value: label, checked: current.response === label });
        const row = el("label", { class: "option" + (current.response === label ? " selected" : "") }, input,
          q.type === "mc" ? el("span", { class: "letter" }, label + ".") : "", el("span", {}, texts[i]));
        input.addEventListener("change", () => {
          opts.forEach(o => o.classList.remove("selected"));
          row.classList.add("selected");
          setResponse(label);
        });
        return row;
      });
      body = el("div", { class: "options" }, opts);
    }

    let instruction = INSTRUCTIONS[q.group];
    if (q.type === "short" && withCtx) instruction += " " + REPLIQA_CONTEXT_NOTE;

    let context = "";
    if (withCtx) {
      const inner = q.passage
        ? q.passage.map(p => el("p", {}, p))
        : el("ol", {}, q.context.map(c => el("li", {}, c)));
      context = el("div", { class: "context" }, el("div", { class: "label" }, "Context"), inner);
    }

    next.disabled = !String(current.response || "").trim();
    next.addEventListener("click", () => {
      stopClock();
      if (state.index < list.length - 1) { state.index += 1; save(); render(); }
      else { state.stage = state.phase + "_done"; save(); render(); }
    });
    back.addEventListener("click", () => { stopClock(); state.index -= 1; save(); render(); });

    const pct = Math.round((state.index / list.length) * 100);
    show(
      el("div", { class: "topline" },
        el("span", {}, (state.phase === "extra" ? "Additional questions \u2014 " : "") + `Question ${state.index + 1} of ${list.length}`),
        el("span", {}, `${pct}%`)),
      el("div", { class: "progress" }, el("div", { style: `width:${pct}%` })),
      el("p", { class: "instruction" }, instruction),
      el("p", { class: "question" }, q.question),
      context,
      body,
      el("div", { class: "nav" }, back, next),
    );
    shownAt = Date.now();
  }

  // ---------- Submit ----------
  function renderDone(error) {
    const phase = state.phase;
    const submit = el("button", {}, "Submit answers");
    const review = el("button", { class: "secondary" }, "Review my answers");
    review.addEventListener("click", () => { state.stage = "question"; state.index = 0; save(); render(); });
    submit.addEventListener("click", () => {
      submit.disabled = true; review.disabled = true;
      submit.textContent = "Submitting…";
      submitPhase(phase).then(() => {
        state.submitted[phase] = true;
        state.stage = phase === "main" && state.assignment.extra.length ? "ask_more" : "finished";
        save();
        render();
      }).catch(() => renderDone("Your answers could not be submitted. Please check your connection and try again."));
    });
    show(
      el("h1", {}, "All questions answered"),
      el("p", {}, `You have answered all ${items().length} questions${phase === "extra" ? " in the additional set" : ""}. You can review your answers or submit them now.`),
      el("div", { class: "btnrow" }, review, submit),
      error ? el("p", { class: "error center" }, error) : "",
    );
  }

  function renderAskMore() {
    const yes = el("button", {}, "Yes, continue");
    const no = el("button", { class: "secondary" }, "No, I\u2019m done");
    yes.addEventListener("click", () => { state.phase = "extra"; state.index = 0; state.stage = "question"; save(); render(); });
    no.addEventListener("click", () => { state.stage = "finished"; save(); render(); });
    show(
      el("h1", {}, "Thank you! Your answers have been submitted."),
      el("p", {}, "Would you mind answering a few more questions? They follow the same format and are entirely optional."),
      el("div", { class: "btnrow" }, no, yes),
    );
  }

  function renderFinished() {
    show(
      el("div", { class: "center" },
        el("h1", {}, "Thank you for participating!"),
        el("p", {}, "Your responses have been recorded. You may now close this page.")),
    );
  }

  function render() {
    if (state.stage === "intro" || !state.assignment) return renderIntro();
    if (state.stage === "question") return renderQuestion();
    if (state.stage === "main_done" || state.stage === "extra_done") return renderDone();
    if (state.stage === "ask_more") return renderAskMore();
    return renderFinished();
  }

  // ---------- Backend ----------
  function assign() {
    if (LOCAL_MODE) return Promise.resolve(localAssign());
    const url = `${APPS_SCRIPT_URL}?action=assign&name=${encodeURIComponent(state.name)}`;
    return fetch(url).then(r => r.json()).then(res => { if (!res.ok) throw new Error(res.error); return res; });
  }

  function submitPhase(phase) {
    const payload = {
      action: "submit",
      participant_id: state.participant_id,
      phase: phase,
      user_agent: navigator.userAgent,
      answers: state.assignment[phase].map((item, i) => {
        const a = state.answers[phase][item.qid] || {};
        return { qid: item.qid, response: a.response || "", time_ms: a.time_ms || 0, position: i + 1 };
      }),
    };
    if (LOCAL_MODE) {
      console.log("Local mode submission", payload);
      const blob = new Blob([JSON.stringify({ ...payload, assignment: state.assignment }, null, 2)], { type: "application/json" });
      const link = el("a", { href: URL.createObjectURL(blob), download: `local_${phase}_${state.participant_id}.json` });
      link.click();
      return Promise.resolve({ ok: true });
    }
    return fetch(APPS_SCRIPT_URL, { method: "POST", body: JSON.stringify(payload) })
      .then(r => r.json()).then(res => { if (!res.ok) throw new Error(res.error); return res; });
  }

  // Mirrors randomAssignment_/complement_ in Code.gs, for local testing only.
  function localAssign() {
    const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const counts = { strategyqa: 16, mc: 20, repliqa: 5 };
    const split = ids => {
      const s = shuffle(ids.slice());
      let nWith = Math.floor(s.length / 2);
      if (s.length % 2 && Math.random() < 0.5) nWith += 1;
      return s.map((qid, i) => ({ qid, condition: i < nWith ? "with_context" : "without_context" }));
    };
    let pending = JSON.parse(localStorage.getItem("cogqa_local_pending") || "null");
    let assignment, role;
    if (pending) {
      assignment = pending; role = "B";
      localStorage.removeItem("cogqa_local_pending");
    } else {
      const main = [], extra = [];
      Object.keys(counts).forEach(g => {
        const ids = shuffle(QUESTIONS.filter(q => q.group === g).map(q => q.id));
        main.push(...split(ids.slice(0, counts[g])));
        extra.push(...split(ids.slice(counts[g])));
      });
      assignment = { main, extra }; role = "A";
      const flip = x => ({ qid: x.qid, condition: x.condition === "with_context" ? "without_context" : "with_context" });
      localStorage.setItem("cogqa_local_pending", JSON.stringify({ main: main.map(flip), extra: extra.map(flip) }));
    }
    return {
      ok: true, participant_id: "local-" + Date.now(), pair_id: 0, pair_role: role,
      assignment: { main: shuffle(assignment.main.slice()), extra: shuffle(assignment.extra.slice()) },
    };
  }

  window.addEventListener("beforeunload", e => {
    if (state.stage === "question" || state.stage === "main_done" || state.stage === "extra_done") {
      if (state.stage === "question") { stopClock(); shownAt = Date.now(); }
      e.preventDefault();
      e.returnValue = "";
    }
  });

  render();
})();
