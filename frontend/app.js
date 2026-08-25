/* BKM IEDF/IADF Simulator frontend */
"use strict";

const $ = (sel) => document.querySelector(sel);

const state = {
  model: "1d",
  defaults: { "1d": null, "2d": null },
  xsecFiles: [],
  waveforms: [],
  presetConfig: null,
  compareSet: new Set(),
  historyJobs: [],
  activeTimer: null,
};

const COLORS = ["#3b528b", "#21918c", "#5ec962", "#f9a825", "#c62828",
                "#7b1fa2"];

const GROUP_LABELS = {
  waveform: "駆動波形", wafer_waveform: "ウェハ波形", ring_waveform: "リング波形",
  plasma: "プラズマ", circuit: "回路（KCL）", electrodes: "電極面積比",
  sheath: "シースモデル", gas: "ガス・衝突断面積", tpmc: "TPMC粒子計算",
  plot: "プロット", geometry: "形状", field2d: "2D場ソルバ",
  space_charge: "空間電荷補正", analysis: "端傾き解析",
};

const ENUMS = {
  "sheath.model": ["moving_front", "static_width"],
  "gas.cross_section_source": ["lxcat_phelps", "approximation"],
  x_axis: ["time_s", "time_ns", "time_us", "phase_deg", "phase_rad"],
};

const OPEN_GROUPS = new Set(["waveform", "wafer_waveform", "ring_waveform",
                             "plasma", "gas", "tpmc"]);

// ---------------- API ----------------

async function api(path, options = {}) {
  const response = await fetch(path, options);
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body.detail) detail = typeof body.detail === "string"
        ? body.detail : JSON.stringify(body.detail);
    } catch (_e) { /* 本文なし */ }
    throw new Error(detail);
  }
  return response.json();
}

function adminHeaders() {
  const pass = sessionStorage.getItem("bkmAdminPass");
  return pass ? { Authorization: `Bearer ${pass}` } : {};
}

function isAdmin() { return !!sessionStorage.getItem("bkmAdminPass"); }

function setMessage(sel, text, kind = "") {
  const node = $(sel);
  node.textContent = text;
  node.className = `message ${kind}`;
}

// ---------------- タブ ----------------

function switchTab(name) {
  document.querySelectorAll("nav#tabs button").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === name));
  ["run", "history", "compare"].forEach((tab) =>
    $(`#tab-${tab}`).classList.toggle("hidden", tab !== name));
  if (name === "history") loadHistory();
}

// ---------------- 設定フォーム ----------------

function inputId(group, key) { return `f|${group}|${key}`; }

function fieldInput(group, key, value) {
  const id = inputId(group, key);
  const enumKey = ENUMS[`${group}.${key}`] ? `${group}.${key}`
    : (ENUMS[key] ? key : null);
  if (group === "gas" && key === "xsec_csv_name") {
    const options = state.xsecFiles.map((f) =>
      `<option value="${f}" ${f === value ? "selected" : ""}>${f}</option>`);
    return `<label>${key}<select id="${id}">${options.join("")}</select></label>`;
  }
  if (enumKey) {
    const options = ENUMS[enumKey].map((v) =>
      `<option value="${v}" ${v === value ? "selected" : ""}>${v}</option>`);
    return `<label>${key}<select id="${id}">${options.join("")}</select></label>`;
  }
  if (typeof value === "boolean") {
    return `<label>${key}<input type="checkbox" id="${id}" ${value ? "checked" : ""}></label>`;
  }
  if (Array.isArray(value)) {
    return `<label>${key}（カンマ区切り）<input id="${id}" value="${value.join(", ")}"></label>`;
  }
  if (typeof value === "number") {
    return `<label>${key}<input id="${id}" value="${value}"></label>`;
  }
  if (value === null) {
    return `<label>${key}（空=自動）<input id="${id}" value=""></label>`;
  }
  return `<label>${key}<input id="${id}" value="${value}"></label>`;
}

function waveformGroupHtml(group, values, isRing) {
  const modes = isRing ? ["sinusoid", "csv", "scaled_wafer"]
    : ["sinusoid", "csv"];
  const modeOptions = modes.map((m) =>
    `<option value="${m}" ${m === values.mode ? "selected" : ""}>${m}</option>`);
  let body = "";
  if (values.mode === "sinusoid") {
    body = ["sinusoid_dc_V", "sinusoid_amplitude_V", "sinusoid_phase_offset_deg"]
      .map((k) => fieldInput(group, k, values[k])).join("");
  } else if (values.mode === "csv") {
    const wfOptions = state.waveforms.map((w) =>
      `<option value="${w.id}" ${w.id === values.waveform_id ? "selected" : ""}>` +
      `#${w.id} ${w.name}</option>`);
    body = `
      <label>登録済み波形
        <select id="${inputId(group, "waveform_id")}">
          <option value="">選択してください</option>${wfOptions.join("")}
        </select>
      </label>
      <label>新規CSVアップロード
        <input type="file" id="${inputId(group, "upload")}" accept=".csv,.txt">
      </label>`
      + ["x_axis", "delimiter", "skip_header_rows", "x_column",
         "voltage_column", "voltage_scale", "voltage_offset_V",
         "phase_offset_deg"]
        .map((k) => fieldInput(group, k, values[k])).join("");
  } else {
    body = ["wafer_scale", "wafer_phase_offset_deg", "dc_offset_V"]
      .map((k) => fieldInput(group, k, values[k])).join("");
  }
  return `
    <label>mode<select id="${inputId(group, "mode")}" data-wf-group="${group}">
      ${modeOptions.join("")}</select></label>${body}`;
}

function isWaveformGroup(group) {
  return ["waveform", "wafer_waveform", "ring_waveform"].includes(group);
}

function buildForm() {
  const defaults = state.defaults[state.model];
  if (!defaults) return;
  const config = JSON.parse(JSON.stringify(defaults));
  if (state.presetConfig) deepMerge(config, state.presetConfig);
  state.formConfig = config;

  const container = $("#config-form");
  container.innerHTML = "";
  for (const [group, values] of Object.entries(config)) {
    const label = GROUP_LABELS[group] || group;
    const open = OPEN_GROUPS.has(group) ? "open" : "";
    const inner = isWaveformGroup(group)
      ? waveformGroupHtml(group, values, group === "ring_waveform")
      : Object.entries(values)
          .filter(([k]) => !["csv_text", "waveform_id"].includes(k))
          .map(([k, v]) => fieldInput(group, k, v)).join("");
    const card = document.createElement("div");
    card.className = "card config-group";
    card.innerHTML = `<details ${open}><summary>${label}</summary>
      <div class="config-grid" id="grid|${group}">${inner}</div></details>`;
    container.appendChild(card);
  }

}

// フォームは再描画されるため、#config-formへのイベント委譲で処理する
function onConfigFormChange(event) {
  const target = event.target;
  if (target.dataset && target.dataset.wfGroup) {
    const group = target.dataset.wfGroup;
    state.formConfig[group] = collectWaveformGroup(group);
    state.formConfig[group].mode = target.value;
    document.getElementById(`grid|${group}`).innerHTML =
      waveformGroupHtml(group, state.formConfig[group],
                        group === "ring_waveform");
    return;
  }
  if (target.type === "file" && target.id.endsWith("|upload")) {
    handleWaveformUpload(target);
  }
}

async function handleWaveformUpload(input) {
  if (!input.files.length) return;
  const group = input.id.split("|")[1];
  const form = new FormData();
  form.append("file", input.files[0]);
  try {
    const uploaded = await api("/api/waveforms", { method: "POST", body: form });
    await loadWaveforms();
    const select = document.getElementById(inputId(group, "waveform_id"));
    select.innerHTML = `<option value="">選択してください</option>`
      + state.waveforms.map((w) =>
        `<option value="${w.id}" ${w.id === uploaded.id ? "selected" : ""}>` +
        `#${w.id} ${w.name}</option>`).join("");
    setMessage("#run-message",
      uploaded.duplicated ? `同一内容の波形#${uploaded.id}を再利用します`
        : `波形#${uploaded.id}を登録しました`, "ok");
  } catch (error) {
    setMessage("#run-message", `波形アップロード失敗: ${error.message}`, "error");
  }
}

function deepMerge(target, source) {
  for (const [key, value] of Object.entries(source || {})) {
    if (value && typeof value === "object" && !Array.isArray(value)
        && target[key] && typeof target[key] === "object") {
      deepMerge(target[key], value);
    } else if (key in target) {
      target[key] = value;
    }
  }
}

function readField(group, key, defaultValue) {
  const node = document.getElementById(inputId(group, key));
  if (!node) return defaultValue;
  if (node.type === "checkbox") return node.checked;
  const raw = node.value.trim();
  if (Array.isArray(defaultValue)) {
    return raw ? raw.split(",").map((s) => parseFloat(s.trim()))
      .filter((v) => Number.isFinite(v)) : [];
  }
  if (typeof defaultValue === "number") {
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed)) throw new Error(`${group}.${key} が数値ではありません`);
    return Number.isInteger(defaultValue) && Number.isInteger(parsed)
      ? parseInt(raw, 10) : parsed;
  }
  if (defaultValue === null) {
    if (raw === "") return null;
    const parsed = parseFloat(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}

function collectWaveformGroup(group) {
  const defaults = state.defaults[state.model][group];
  const values = { ...defaults };
  const modeNode = document.getElementById(inputId(group, "mode"));
  values.mode = modeNode ? modeNode.value : defaults.mode;
  for (const key of Object.keys(defaults)) {
    if (["mode", "csv_text", "waveform_id"].includes(key)) continue;
    values[key] = readField(group, key, defaults[key]);
  }
  const wfSelect = document.getElementById(inputId(group, "waveform_id"));
  values.waveform_id = wfSelect && wfSelect.value
    ? parseInt(wfSelect.value, 10) : null;
  values.csv_text = null;
  return values;
}

function collectConfig() {
  const defaults = state.defaults[state.model];
  const config = {};
  for (const [group, values] of Object.entries(defaults)) {
    if (isWaveformGroup(group)) {
      config[group] = collectWaveformGroup(group);
    } else {
      config[group] = {};
      for (const [key, defaultValue] of Object.entries(values)) {
        config[group][key] = readField(group, key, defaultValue);
      }
    }
  }
  return config;
}

// ---------------- 実行 ----------------

async function runJob() {
  let config;
  try {
    config = collectConfig();
  } catch (error) {
    setMessage("#run-message", error.message, "error");
    return;
  }
  try {
    const job = await api("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: state.model,
        label: $("#job-label").value,
        submitted_by: $("#job-user").value,
        config,
      }),
    });
    setMessage("#run-message",
      `ジョブ ${job.id.slice(0, 8)} を投入しました`, "ok");
    refreshActiveJobs();
  } catch (error) {
    setMessage("#run-message", `投入失敗: ${error.message}`, "error");
  }
}

async function refreshActiveJobs() {
  try {
    const body = await api("/api/jobs?limit=20");
    const active = body.jobs.filter((j) =>
      ["queued", "running"].includes(j.status));
    const container = $("#active-jobs");
    if (!active.length) {
      container.innerHTML = `<p class="muted">なし</p>`;
      return;
    }
    container.innerHTML = active.map((job) => {
      const percent = Math.round((job.progress || 0) * 100);
      return `<div class="row" style="margin-bottom:6px">
        <span class="status-chip status-${job.status}">${job.status}</span>
        <span>${job.model.toUpperCase()} ${job.label || job.id.slice(0, 8)}</span>
        <span class="progress-outer"><span class="progress-inner"
          style="width:${percent}%"></span></span>
        <span>${percent}% ${job.progress_text || ""}</span>
        <button data-cancel="${job.id}" class="danger">キャンセル</button>
      </div>`;
    }).join("");
    container.querySelectorAll("button[data-cancel]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        try {
          await api(`/api/jobs/${btn.dataset.cancel}/cancel`, { method: "POST" });
          refreshActiveJobs();
        } catch (error) {
          setMessage("#run-message", error.message, "error");
        }
      }));
  } catch (_error) { /* サーバー未応答時は次回ポーリングで回復 */ }
}

// ---------------- 履歴 ----------------

function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")} ` +
    `${String(d.getHours()).padStart(2, "0")}:` +
    `${String(d.getMinutes()).padStart(2, "0")}`;
}

function summaryCell(job) {
  const rows = job.summary && job.summary.rows;
  if (!rows || !rows.length) return "-";
  const first = rows[0];
  const energy = first.mean_energy_eV ?? first.wafer_mean_energy_eV;
  if (energy == null) return "-";
  const pressures = rows.map((r) => r.pressure_mTorr).join("/");
  return `${pressures} mTorr, &lt;E&gt;=${energy.toFixed(1)} eV`;
}

async function loadHistory() {
  const params = new URLSearchParams({ limit: "100" });
  if ($("#filter-model").value) params.set("model", $("#filter-model").value);
  if ($("#filter-status").value) params.set("status", $("#filter-status").value);
  if ($("#filter-q").value) params.set("q", $("#filter-q").value);
  try {
    const body = await api(`/api/jobs?${params}`);
    state.historyJobs = body.jobs;
    renderHistory();
    setMessage("#history-message", `${body.total}件`, "");
  } catch (error) {
    setMessage("#history-message", error.message, "error");
  }
}

function renderHistory() {
  const rows = state.historyJobs.map((job) => {
    const check = job.status === "done"
      ? `<input type="checkbox" data-compare="${job.id}"
          ${state.compareSet.has(job.id) ? "checked" : ""}>` : "";
    const valid = job.validation
      ? (job.validation.passed
        ? `<span class="validation-ok">合格</span>`
        : `<span class="validation-ng">要確認</span>`) : "-";
    const del = isAdmin()
      ? `<button class="danger" data-delete="${job.id}">削除</button>` : "";
    return `<tr>
      <td>${check}</td>
      <td>${formatDate(job.created_at)}</td>
      <td>${job.model.toUpperCase()}</td>
      <td>${job.label || `<span class="muted">${job.id.slice(0, 8)}</span>`}</td>
      <td>${job.submitted_by || "-"}</td>
      <td><span class="status-chip status-${job.status}">${job.status}</span></td>
      <td>${summaryCell(job)}</td>
      <td>${valid}</td>
      <td><button data-detail="${job.id}">詳細</button> ${del}</td>
    </tr>`;
  }).join("");
  $("#history-table").innerHTML = `<table>
    <thead><tr><th></th><th>日時</th><th>モデル</th><th>ラベル</th>
    <th>投入者</th><th>状態</th><th>条件・結果</th><th>検証</th><th>操作</th>
    </tr></thead><tbody>${rows}</tbody></table>`;

  $("#history-table").querySelectorAll("input[data-compare]").forEach((box) =>
    box.addEventListener("change", () => {
      if (box.checked) state.compareSet.add(box.dataset.compare);
      else state.compareSet.delete(box.dataset.compare);
      updateCompareButton();
    }));
  $("#history-table").querySelectorAll("button[data-detail]").forEach((btn) =>
    btn.addEventListener("click", () => openDetail(btn.dataset.detail)));
  $("#history-table").querySelectorAll("button[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => deleteJob(btn.dataset.delete)));
  updateCompareButton();
}

function updateCompareButton() {
  const button = $("#compare-selected");
  button.textContent = `選択を比較 (${state.compareSet.size})`;
  button.disabled = state.compareSet.size < 2;
}

async function deleteJob(jobId) {
  if (!window.confirm("このジョブの結果ファイルを削除します（DB記録と監査ログは残ります）。よろしいですか？")) return;
  try {
    await api(`/api/jobs/${jobId}`, { method: "DELETE",
      headers: adminHeaders() });
    setMessage("#history-message", "削除しました（監査ログに記録）", "ok");
    loadHistory();
  } catch (error) {
    setMessage("#history-message", `削除失敗: ${error.message}`, "error");
  }
}

// ---------------- 詳細表示 ----------------

const PLOT_LAYOUT = {
  margin: { l: 55, r: 15, t: 36, b: 45 },
  font: { size: 12 },
  legend: { orientation: "h", y: -0.22 },
};

function linePlot(div, traces, { title, xtitle, ytitle, logy = false,
                                 shapes = [] } = {}) {
  Plotly.newPlot(div, traces, {
    ...PLOT_LAYOUT, title: { text: title, font: { size: 13 } },
    xaxis: { title: { text: xtitle } },
    yaxis: { title: { text: ytitle }, type: logy ? "log" : "linear" },
    shapes,
  }, { responsive: true, displaylogo: false });
}

function centers(edges) {
  const out = [];
  for (let i = 0; i + 1 < edges.length; i++) out.push(0.5 * (edges[i] + edges[i + 1]));
  return out;
}

function heatmapPlot(div, entry, title) {
  const z = entry.density.map((row) =>
    row.map((v) => (v > 0 ? Math.log10(v) : null)));
  Plotly.newPlot(div, [{
    type: "heatmap", z,
    x: centers(entry.angle_edges_deg), y: centers(entry.energy_edges_eV),
    colorscale: "Viridis",
    colorbar: { title: { text: "log10 f", side: "right" }, thickness: 12 },
    hovertemplate: "angle=%{x:.1f}deg<br>E=%{y:.1f}eV<br>log10f=%{z:.2f}<extra></extra>",
  }], {
    ...PLOT_LAYOUT, title: { text: title, font: { size: 13 } },
    xaxis: { title: { text: "Signed angle [deg]" } },
    yaxis: { title: { text: "Ion impact energy [eV]" } },
  }, { responsive: true, displaylogo: false });
}

function validationHtml(validation) {
  if (!validation) return "";
  const rows = Object.entries(validation)
    .filter(([k]) => k !== "passed")
    .map(([k, v]) => {
      let value = v;
      if (typeof v === "number") value = Math.abs(v) < 1e-2 || Math.abs(v) > 1e4
        ? v.toExponential(3) : v.toFixed(4);
      if (typeof v === "object") value = JSON.stringify(v);
      return `<dt>${k}</dt><dd>${value}</dd>`;
    }).join("");
  const badge = validation.passed
    ? `<span class="validation-ok">検証合格</span>`
    : `<span class="validation-ng">検証要確認</span>`;
  return `<div class="card"><h2>数値検証 ${badge}</h2>
    <dl class="kv">${rows}</dl></div>`;
}

function detailHeaderHtml(job) {
  return `<div class="card"><h2>${job.model.toUpperCase()}:
      ${job.label || job.id.slice(0, 8)}</h2>
    <dl class="kv">
      <dt>ジョブID</dt><dd>${job.id}</dd>
      <dt>投入者</dt><dd>${job.submitted_by || "-"}</dd>
      <dt>投入日時</dt><dd>${formatDate(job.created_at)}</dd>
      <dt>完了日時</dt><dd>${formatDate(job.finished_at)}</dd>
      <dt>状態</dt><dd><span class="status-chip status-${job.status}">${job.status}</span></dd>
    </dl>
    <div class="row" style="margin-top:10px">
      <a href="/api/jobs/${job.id}/download/npz" download><button>生データNPZ</button></a>
      <a href="/api/jobs/${job.id}/download/config" download><button>設定JSON</button></a>
      <a href="/api/jobs/${job.id}/download/plots" download><button>プロットJSON</button></a>
      <button id="reuse-config">この設定を再利用</button>
    </div>
    ${job.error ? `<pre class="config-view">${job.error}</pre>` : ""}
  </div>`;
}

function summaryTableHtml(rows, model) {
  if (!rows || !rows.length) return "";
  if (model === "1d") {
    const body = rows.map((r) => `<tr>
      <td class="num">${r.pressure_mTorr}</td>
      <td class="num">${r.hit_percent?.toFixed(1)}</td>
      <td class="num">${r.mean_energy_eV?.toFixed(1)}</td>
      <td class="num">${r.e05_eV?.toFixed(1)} – ${r.e95_eV?.toFixed(1)}</td>
      <td class="num">${r.mean_abs_angle_deg?.toFixed(2)}</td>
      <td class="num">${r.mean_transit_over_T?.toFixed(2)}</td>
      <td class="num">${r.cx_percent?.toFixed(1)}</td></tr>`).join("");
    return `<div class="card"><h2>要約</h2><table><thead><tr>
      <th class="num">p [mTorr]</th><th class="num">到達 [%]</th>
      <th class="num">&lt;E&gt; [eV]</th><th class="num">E05–E95 [eV]</th>
      <th class="num">|角度|平均 [deg]</th><th class="num">&lt;τ&gt;/T</th>
      <th class="num">CX [%]</th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  const body = rows.map((r) => `<tr>
    <td class="num">${r.pressure_mTorr}</td>
    <td class="num">${r.edge_outward_tilt_deg?.toFixed(2)}</td>
    <td class="num">${(r.affected_width_m * 1e3)?.toFixed(2)}</td>
    <td class="num">${r.wafer_mean_energy_eV?.toFixed(1)}</td>
    <td class="num">${r.ring_mean_energy_eV?.toFixed(1)}</td>
    <td class="num">${r.n_reached}</td></tr>`).join("");
  return `<div class="card"><h2>要約（端傾き）</h2><table><thead><tr>
    <th class="num">p [mTorr]</th><th class="num">端の外向き傾き [deg]</th>
    <th class="num">影響領域幅 [mm]</th><th class="num">wafer &lt;E&gt; [eV]</th>
    <th class="num">ring &lt;E&gt; [eV]</th><th class="num">到達数</th>
    </tr></thead><tbody>${body}</tbody></table></div>`;
}

async function openDetail(jobId) {
  const container = $("#job-detail");
  container.classList.remove("hidden");
  container.innerHTML = `<div class="card"><p class="muted">読み込み中...</p></div>`;
  try {
    const job = await api(`/api/jobs/${jobId}`);
    let plots = null;
    if (job.status === "done") {
      plots = await api(`/api/jobs/${jobId}/plots`);
    }
    renderDetail(job, plots);
    container.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    container.innerHTML = `<div class="card"><p class="message error">${error.message}</p></div>`;
  }
}

function renderDetail(job, plots) {
  const container = $("#job-detail");
  let html = detailHeaderHtml(job);
  if (plots) {
    html += summaryTableHtml(plots.summary_rows, plots.model);
    html += `<div class="card"><h2>プラズマ電位・シース電圧</h2>
      <div class="plot-half-wrap"><div id="plot-vp" class="plot"></div>
      <div id="plot-sheath" class="plot"></div></div></div>`;
    if (plots.model === "1d") {
      html += `<div class="card"><h2>IEDF / 符号付きIADF</h2>
        <div id="plot-iedf" class="plot"></div>
        <div class="plot-half-wrap"><div id="plot-iadf" class="plot"></div>
        <div id="plot-iadf-log" class="plot"></div></div></div>`;
      html += `<div class="card"><h2>符号付きIAEDF</h2><div class="plot-half-wrap">`
        + plots.iaedf.map((_e, i) =>
          `<div id="plot-iaedf-${i}" class="plot"></div>`).join("")
        + `</div></div>`;
    } else {
      html += `<div class="card"><h2>位置分解プロファイル</h2>
        <div id="plot-flux" class="plot"></div>
        <div class="plot-half-wrap"><div id="plot-energy-x" class="plot"></div>
        <div id="plot-angle-x" class="plot"></div></div>
        <div id="plot-tilt" class="plot"></div></div>`;
      html += `<div class="card"><h2>電極別IEDF / ウェハIAEDF</h2>
        <div id="plot-iedf" class="plot"></div><div class="plot-half-wrap">`
        + plots.iaedf.map((_e, i) =>
          `<div id="plot-iaedf-${i}" class="plot"></div>`).join("")
        + `</div></div>`;
      if (plots.phi_sc && plots.phi_sc.length) {
        html += `<div class="card"><h2>空間電荷補正電位 φ_sc</h2>`
          + plots.phi_sc.map((_e, i) =>
            `<div id="plot-phisc-${i}" class="plot"></div>`).join("")
          + `</div>`;
      }
    }
  }
  html += validationHtml(job.validation);
  html += `<div class="card"><h2>設定</h2>
    <pre class="config-view">${JSON.stringify(job.config, null, 2)}</pre></div>`;
  container.innerHTML = html;

  $("#reuse-config").addEventListener("click", () => {
    state.presetConfig = job.config;
    state.model = job.model;
    $("#model-select").value = job.model;
    ensureDefaults(job.model).then(() => { buildForm(); switchTab("run"); });
    setMessage("#run-message",
      `ジョブ${job.id.slice(0, 8)}の設定を読み込みました`, "ok");
  });

  if (plots) drawDetailPlots(plots);
}

function drawDetailPlots(plots) {
  const wf = plots.vp_waveform;
  if (plots.model === "1d") {
    linePlot("plot-vp", [
      { x: wf.phase_deg, y: wf.V_e, name: "driven V_e", line: { color: COLORS[0] } },
      { x: wf.phase_deg, y: wf.V_p, name: "plasma V_p", line: { color: COLORS[3] } },
    ], { title: "電位", xtitle: "RF phase [deg]", ytitle: "Potential [V]" });
    linePlot("plot-sheath", [
      { x: wf.phase_deg, y: wf.V_sp, name: "powered V_sp", line: { color: COLORS[0] } },
      { x: wf.phase_deg, y: wf.V_sg, name: "ground V_sg", line: { color: COLORS[1] } },
    ], { title: "シース電圧", xtitle: "RF phase [deg]", ytitle: "Sheath voltage [V]" });

    linePlot("plot-iedf", plots.iedf.map((entry, i) => ({
      x: centers(entry.edges_eV), y: entry.density,
      name: `${entry.pressure_mTorr} mTorr`, line: { color: COLORS[i % COLORS.length] },
    })), { title: "IEDF", xtitle: "Ion impact energy [eV]", ytitle: "IEDF [1/eV]" });

    const iadfTraces = (log) => plots.iadf.map((entry, i) => ({
      x: entry.angle_deg,
      y: log ? entry.density.map((v) => Math.max(v, 1e-7)) : entry.density,
      name: `${entry.pressure_mTorr} mTorr`, line: { color: COLORS[i % COLORS.length] },
    }));
    linePlot("plot-iadf", iadfTraces(false),
      { title: "符号付きIADF (linear)", xtitle: "Signed angle [deg]", ytitle: "IADF [1/deg]" });
    linePlot("plot-iadf-log", iadfTraces(true),
      { title: "符号付きIADF (log)", xtitle: "Signed angle [deg]", ytitle: "IADF [1/deg]", logy: true });
    plots.iaedf.forEach((entry, i) =>
      heatmapPlot(`plot-iaedf-${i}`, entry, `IAEDF ${entry.pressure_mTorr} mTorr`));
  } else {
    linePlot("plot-vp", [
      { x: wf.phase_deg, y: wf.V_w, name: "wafer V_w", line: { color: COLORS[0] } },
      { x: wf.phase_deg, y: wf.V_r, name: "ring V_r", line: { color: COLORS[1], dash: "dash" } },
      { x: wf.phase_deg, y: wf.V_p, name: "plasma V_p", line: { color: COLORS[3] } },
    ], { title: "電位", xtitle: "RF phase [deg]", ytitle: "Potential [V]" });
    linePlot("plot-sheath", [
      { x: wf.phase_deg, y: wf.V_sw, name: "V_sw", line: { color: COLORS[0] } },
      { x: wf.phase_deg, y: wf.V_sr, name: "V_sr", line: { color: COLORS[1], dash: "dash" } },
    ], { title: "シース電圧", xtitle: "RF phase [deg]", ytitle: "Sheath voltage [V]" });

    const geometry = plots.geometry;
    const edgeShapes = [geometry.wafer_left_mm, geometry.wafer_right_mm].map((x) => ({
      type: "line", x0: x, x1: x, yref: "paper", y0: 0, y1: 1,
      line: { color: "#999", width: 1, dash: "dot" },
    }));
    const profileTraces = (key) => plots.profiles.map((profile, i) => ({
      x: profile.x_mm, y: profile[key],
      name: `${profile.pressure_mTorr} mTorr`,
      line: { color: COLORS[i % COLORS.length] },
    }));
    linePlot("plot-flux", profileTraces("flux"),
      { title: "フラックス密度", xtitle: "x [mm]", ytitle: "Flux [a.u.]", shapes: edgeShapes });
    linePlot("plot-energy-x", profileTraces("mean_energy_eV"),
      { title: "平均エネルギー", xtitle: "x [mm]", ytitle: "Mean energy [eV]", shapes: edgeShapes });
    linePlot("plot-angle-x", profileTraces("mean_angle_deg"),
      { title: "平均符号付き角度", xtitle: "x [mm]", ytitle: "Mean angle [deg]", shapes: edgeShapes });

    const tiltTraces = plots.summary_rows
      .filter((r) => r.tilt_profile_distance_m)
      .map((r, i) => ({
        x: r.tilt_profile_distance_m.map((v) => v * 1e3),
        y: r.tilt_profile_deg,
        name: `${r.pressure_mTorr} mTorr`,
        line: { color: COLORS[i % COLORS.length] },
      }));
    linePlot("plot-tilt", tiltTraces,
      { title: "ウェハ端からの距離 vs 外向き傾き", xtitle: "Distance from wafer edge [mm]", ytitle: "Outward tilt [deg]" });

    const iedfTraces = [];
    plots.iedf.forEach((entry, i) => {
      iedfTraces.push({ x: centers(entry.edges_eV), y: entry.wafer_density,
        name: `wafer ${entry.pressure_mTorr} mTorr`,
        line: { color: COLORS[i % COLORS.length] } });
      if (entry.ring_density) {
        iedfTraces.push({ x: centers(entry.edges_eV), y: entry.ring_density,
          name: `ring ${entry.pressure_mTorr} mTorr`,
          line: { color: COLORS[i % COLORS.length], dash: "dash" } });
      }
    });
    linePlot("plot-iedf", iedfTraces,
      { title: "電極別IEDF", xtitle: "Ion impact energy [eV]", ytitle: "IEDF [1/eV]" });
    plots.iaedf.forEach((entry, i) =>
      heatmapPlot(`plot-iaedf-${i}`, entry,
        `Wafer IAEDF ${entry.pressure_mTorr} mTorr`));
    (plots.phi_sc || []).forEach((entry, i) => {
      Plotly.newPlot(`plot-phisc-${i}`, [{
        type: "heatmap", z: entry.phi_sc_V, x: entry.x_mm, y: entry.y_mm,
        colorscale: "RdBu", zmid: 0,
        colorbar: { title: { text: "φ_sc [V]" }, thickness: 12 },
      }], { ...PLOT_LAYOUT,
        title: { text: `φ_sc ${entry.pressure_mTorr} mTorr`, font: { size: 13 } },
        xaxis: { title: { text: "x [mm]" } },
        yaxis: { title: { text: "y [mm]" } },
      }, { responsive: true, displaylogo: false });
    });
  }
}

// ---------------- 比較 ----------------

async function runCompare() {
  const ids = [...state.compareSet];
  try {
    const body = await api(`/api/compare?ids=${ids.join(",")}`);
    switchTab("compare");
    renderCompare(body);
  } catch (error) {
    setMessage("#history-message", `比較失敗: ${error.message}`, "error");
  }
}

function renderCompare(body) {
  const container = $("#compare-result");
  let html = `<div class="card"><h2>IEDF比較</h2>
    <div id="cmp-iedf" class="plot"></div></div>`;
  const hasIadf = body.jobs.some((j) => j.iadf && j.iadf.length);
  if (hasIadf) {
    html += `<div class="card"><h2>IADF比較</h2>
      <div id="cmp-iadf" class="plot"></div></div>`;
  }
  const diffRows = body.config_diff.map((d) => `<tr><td>${d.key}</td>` +
    d.values.map((v) => `<td>${v === null ? "-" : JSON.stringify(v)}</td>`)
      .join("") + "</tr>").join("");
  html += `<div class="card"><h2>設定の差分</h2>
    ${body.config_diff.length ? `<table><thead><tr><th>パラメータ</th>
    ${body.jobs.map((j) => `<th>${j.label}</th>`).join("")}</tr></thead>
    <tbody>${diffRows}</tbody></table>`
    : `<p class="muted">設定に差分はありません。</p>`}</div>`;
  container.innerHTML = html;

  const iedfTraces = [];
  body.jobs.forEach((job, jobIndex) => {
    (job.iedf || []).forEach((entry, pressureIndex) => {
      const color = COLORS[jobIndex % COLORS.length];
      const dashes = ["solid", "dash", "dot", "dashdot"];
      const y = entry.density || entry.wafer_density;
      iedfTraces.push({
        x: centers(entry.edges_eV), y,
        name: `${job.label} ${entry.pressure_mTorr}mTorr`,
        line: { color, dash: dashes[pressureIndex % dashes.length] },
      });
    });
  });
  linePlot("cmp-iedf", iedfTraces,
    { title: "IEDF", xtitle: "Ion impact energy [eV]", ytitle: "IEDF [1/eV]" });

  if (hasIadf) {
    const iadfTraces = [];
    body.jobs.forEach((job, jobIndex) => {
      (job.iadf || []).forEach((entry, pressureIndex) => {
        const dashes = ["solid", "dash", "dot", "dashdot"];
        iadfTraces.push({
          x: entry.angle_deg, y: entry.density,
          name: `${job.label} ${entry.pressure_mTorr}mTorr`,
          line: { color: COLORS[jobIndex % COLORS.length],
                  dash: dashes[pressureIndex % dashes.length] },
        });
      });
    });
    linePlot("cmp-iadf", iadfTraces,
      { title: "符号付きIADF", xtitle: "Signed angle [deg]", ytitle: "IADF [1/deg]" });
  }
}

// ---------------- 管理者 ----------------

function refreshAdminUi() {
  $("#admin-badge").classList.toggle("hidden", !isAdmin());
  $("#admin-login-btn").textContent = isAdmin() ? "ログアウト" : "管理者ログイン";
}

async function adminLoginToggle() {
  if (isAdmin()) {
    sessionStorage.removeItem("bkmAdminPass");
    refreshAdminUi();
    renderHistory();
    return;
  }
  const password = window.prompt("管理者パスワードを入力してください");
  if (!password) return;
  try {
    await api("/api/admin/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    sessionStorage.setItem("bkmAdminPass", password);
    refreshAdminUi();
    renderHistory();
  } catch (error) {
    window.alert(`ログイン失敗: ${error.message}`);
  }
}

// ---------------- 初期化 ----------------

async function ensureDefaults(model) {
  if (!state.defaults[model]) {
    const body = await api(`/api/defaults/${model}`);
    state.defaults[model] = body.config;
    state.xsecFiles = body.xsec_files;
  }
}

async function loadWaveforms() {
  state.waveforms = await api("/api/waveforms");
}

async function init() {
  document.querySelectorAll("nav#tabs button").forEach((btn) =>
    btn.addEventListener("click", () => switchTab(btn.dataset.tab)));
  $("#model-select").addEventListener("change", async () => {
    state.model = $("#model-select").value;
    state.presetConfig = null;
    await ensureDefaults(state.model);
    buildForm();
  });
  $("#run-btn").addEventListener("click", runJob);
  $("#config-form").addEventListener("change", onConfigFormChange);
  $("#filter-refresh").addEventListener("click", loadHistory);
  $("#filter-q").addEventListener("keydown", (e) => {
    if (e.key === "Enter") loadHistory();
  });
  $("#compare-selected").addEventListener("click", runCompare);
  $("#admin-login-btn").addEventListener("click", adminLoginToggle);
  refreshAdminUi();

  await ensureDefaults("1d");
  await loadWaveforms();
  buildForm();
  refreshActiveJobs();
  state.activeTimer = setInterval(refreshActiveJobs, 2000);
}

init().catch((error) => setMessage("#run-message", error.message, "error"));
