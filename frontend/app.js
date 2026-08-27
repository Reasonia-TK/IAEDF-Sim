/* KTC model IEDF/IADF Simulator frontend */
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
  lastStatuses: new Map(),
  openLogs: new Set(),
  compareBody: null,
  currentValidation: null,
};

const COLORS = ["#3b528b", "#21918c", "#5ec962", "#f9a825", "#c62828",
                "#7b1fa2"];

const GROUP_LABELS = {
  waveform: "駆動波形", wafer_waveform: "ウェハ波形", ring_waveform: "リング波形",
  plasma: "プラズマ", circuit: "回路（KCL）", electrodes: "電極面積比",
  sheath: "シースモデル", gas: "ガス・衝突断面積", tpmc: "TPMC粒子計算",
  plot: "プロット", geometry: "形状", field2d: "2D場ソルバ",
  space_charge: "空間電荷補正", analysis: "端傾き解析",
  magnetic: "静磁場（イオンのみ）",
};

const ENUMS = {
  "sheath.model": ["moving_front", "static_width"],
  "gas.cross_section_source": ["lxcat_phelps", "approximation"],
  x_axis: ["time_s", "time_ns", "time_us", "phase_deg", "phase_rad"],
};

const MATERIAL_META = {
  wafer: { label: "ウェハ", color: "#1565c0" },
  ring: { label: "リング", color: "#e65100" },
  insulator: { label: "絶縁", color: "#7c8796" },
};

const OPEN_GROUPS = new Set(["waveform", "wafer_waveform", "ring_waveform",
                             "plasma", "gas", "tpmc", "geometry"]);

// フィールドの日本語ラベル [表示名, 補足ツールチップ]
const LABELS = {
  mode: ["波形モード", "sinusoid=正弦波 / csv=CSV読込 / scaled_wafer=ウェハ波形の倍率+DC"],
  x_axis: ["CSV横軸の種類", "time_s=秒 / phase_deg=位相角 など"],
  delimiter: ["区切り文字", ""],
  skip_header_rows: ["ヘッダ行数", "読み飛ばす先頭行数"],
  x_column: ["横軸の列番号", "0始まり"],
  voltage_column: ["電圧の列番号", "0始まり"],
  voltage_scale: ["電圧スケール倍率", ""],
  voltage_offset_V: ["電圧オフセット [V]", ""],
  phase_offset_deg: ["位相オフセット [deg]", ""],
  sinusoid_dc_V: ["DC成分 [V]", "自己バイアス相当"],
  sinusoid_amplitude_V: ["振幅 [V]", ""],
  sinusoid_phase_offset_deg: ["位相オフセット [deg]", ""],
  wafer_scale: ["ウェハ波形倍率", ""],
  wafer_phase_offset_deg: ["位相シフト [deg]", ""],
  dc_offset_V: ["DCオフセット [V]", ""],
  frequency_Hz: ["RF周波数 [Hz]", "既定13.56 MHz"],
  electron_temperature_eV: ["電子温度 Te [eV]", "浮遊電位差・Bohm速度を決める"],
  sheath_edge_density_m3: ["シース端密度 n_s [m^-3]", "イオン電流とシース幅を決める"],
  ion_mass_amu: ["イオン質量 [amu]", "Ar+=39.948, He+=4.0026（断面積データも合わせる）"],
  powered_to_grounded_area_ratio: ["駆動/接地 面積比", "小さいほど駆動側シースに電圧が集中"],
  grounded_electrode_voltage_V: ["接地電極電位 [V]", ""],
  phase_points: ["位相分割数", "KCL積分の1周期分割数"],
  max_cycles: ["最大周期数", "周期定常までの上限"],
  periodic_tolerance_V: ["周期収束判定 [V]", ""],
  capacitance_factor: ["シース容量係数", ""],
  model: ["シースモデル", "moving_front=電子フロント運動シース（検証済みベスト）"],
  front_width_exponent: ["フロント幅指数 p", "s_e = s_max (Vsp/Vsp_max)^p"],
  potential_exponent: ["電位指数 α", "4/3でChild則"],
  gas_temperature_K: ["ガス温度 [K]", ""],
  pressures_mTorr: ["圧力リスト [mTorr]", "カンマ区切りで複数指定可（0=無衝突）"],
  cross_section_source: ["断面積ソース", "lxcat_phelps=評価済みデータ（推奨）"],
  xsec_csv_name: ["断面積データ", "イオン種に合わせて選択"],
  elastic_to_cx_ratio: ["弾性/CX比", "approximation時のみ有効"],
  cross_section_scale: ["断面積スケール", "approximation時のみ有効"],
  n_particles: ["粒子数", "3万で統計良好。条件探索は1/10で高速確認"],
  ion_temperature_eV: ["イオン温度 [eV]", "シース端での熱広がり"],
  steps_per_rf_period: ["ステップ数/RF周期", "衝突確率が大きい場合は増やす"],
  max_rf_periods: ["最大追跡周期数", ""],
  seed: ["乱数シード", "同一シードで結果は再現される"],
  max_recommended_collision_probability: ["衝突確率上限", "検証セルの警告しきい値"],
  energy_bins: ["エネルギービン数", ""],
  angle_bins: ["角度ビン数", "角度刻みが未指定のとき使用"],
  angle_step_deg: ["角度刻み [deg]", "指定するとビン数より優先（ビン数=180/刻み）。空=ビン数を使用"],
  energy_max_eV: ["エネルギー上限 [eV]", "空欄で自動（99.7パーセンタイル）"],
  wafer_to_ground_area_ratio: ["ウェハ/接地 面積比", ""],
  ring_to_ground_area_ratio: ["リング/接地 面積比", ""],
  ground_voltage_V: ["接地電位 [V]", ""],
  domain_length_m: ["領域長 [m]", "左右壁は鏡像対称境界（粒子は鏡面反射）"],
  smoothing_m: ["表面平滑化幅 [m]", "折れ線表面を滑らかにする（0=無効）"],
  top_clearance_factor: ["上端クリアランス係数", "シース幅スケールに対する余裕"],
  nx: ["格子数 nx", ""],
  ny: ["格子数 ny", ""],
  sor_omega: ["SOR緩和係数", "1.9前後で高速収束"],
  tolerance: ["収束判定", ""],
  max_iterations: ["最大反復数", ""],
  enabled: ["空間電荷補正ON", "OFFでLaplaceシース（傾きは下限側）"],
  outer_iterations: ["外部反復回数", "既定5。2で高速傾向確認"],
  deposition_particles: ["密度堆積粒子数", ""],
  under_relaxation: ["緩和係数", "発散する場合は下げる"],
  density_smoothing_sigma_cells: ["密度平滑化σ [セル]", ""],
  ion_density_clip_factor: ["イオン密度クリップ倍率", ""],
  electron_phase_samples: ["電子位相サンプル数", ""],
  max_abs_correction_V: ["補正上限 [V]", ""],
  poisson_tolerance_V: ["Poisson収束判定 [V]", ""],
  poisson_max_iterations: ["Poisson最大反復", ""],
  edge_exclusion_m: ["端除外幅 [m]", "統計から除くウェハ最端部"],
  edge_band_m: ["端帯域幅 [m]", "端傾き平均を取る帯"],
  bin_width_m: ["距離ビン幅 [m]", ""],
  max_distance_m: ["最大距離 [m]", ""],
  affected_threshold_deg: ["影響判定しきい値 [deg]", ""],
  bx_T: ["Bx [T]", "1D: シース深さ方向（イオン入射方向） / 2D: 横方向"],
  by_T: ["By [T]", "1D: 面内横方向（IADF角度の基準） / 2D: 鉛直上向き"],
  bz_T: ["Bz [T]", "1D: 第3軸 / 2D: 面外（紙面手前）"],
};

function fieldLabelText(key) {
  const entry = LABELS[key];
  if (!entry) return { text: key, tip: key };
  return { text: entry[0], tip: entry[1] ? `${key} — ${entry[1]}` : key };
}

// ---------------- API ----------------

async function api(path, options = {}) {
  // 管理者ログイン中は全リクエストに認証ヘッダを付与（2D閲覧などに必要）
  options.headers = { ...adminHeaders(), ...(options.headers || {}) };
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

// 大きい/小さい数値は指数表記で表示する（parseFloatは指数表記入力を受け付ける）
function fmtNum(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 1e-3)) {
    return value.toExponential().replace("e+", "e");
  }
  return String(value);
}

function fieldInput(group, key, value) {
  const id = inputId(group, key);
  const { text, tip } = fieldLabelText(key);
  const wrap = (inner, suffix = "") =>
    `<label title="${tip}">${text}${suffix}${inner}</label>`;
  const enumKey = ENUMS[`${group}.${key}`] ? `${group}.${key}`
    : (ENUMS[key] ? key : null);
  if (group === "gas" && key === "xsec_csv_name") {
    const options = state.xsecFiles.map((f) =>
      `<option value="${f}" ${f === value ? "selected" : ""}>${f}</option>`);
    return wrap(`<select id="${id}">${options.join("")}</select>`);
  }
  if (enumKey) {
    const options = ENUMS[enumKey].map((v) =>
      `<option value="${v}" ${v === value ? "selected" : ""}>${v}</option>`);
    return wrap(`<select id="${id}">${options.join("")}</select>`);
  }
  if (typeof value === "boolean") {
    return wrap(`<input type="checkbox" id="${id}" ${value ? "checked" : ""}>`);
  }
  if (Array.isArray(value)) {
    return wrap(`<input id="${id}" value="${value.join(", ")}">`);
  }
  if (value === null) {
    return wrap(`<input id="${id}" value="" placeholder="自動">`);
  }
  return wrap(`<input id="${id}" value="${fmtNum(value)}">`);
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
  const { text, tip } = fieldLabelText("mode");
  return `
    <label title="${tip}">${text}<select id="${inputId(group, "mode")}"
      data-wf-group="${group}">${modeOptions.join("")}</select></label>${body}`;
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
          .filter(([k]) => !["csv_text", "waveform_id",
                             "profile_points_m"].includes(k))
          .map(([k, v]) => fieldInput(group, k, v)).join("");
    let extra = "";
    if (isWaveformGroup(group)) {
      extra = `<div class="row" style="margin-top:6px">
        <button type="button" data-preview-group="${group}">波形プレビュー</button>
        <span id="wfstat|${group}" class="muted"></span></div>
        <div id="wfprev|${group}" class="plot hidden" style="min-height:240px"></div>`;
    } else if (group === "geometry") {
      extra = `
        <div class="row" style="margin:6px 0 4px">
          <label>プリセット
            <select id="geo-preset">
              <option value="">選択して適用...</option>
              <option value="step">標準（ウェハ+リング段差）</option>
              <option value="taper">テーパーリング</option>
              <option value="recess">リセスウェハ</option>
              <option value="patent_ring">特許型エッジリング（片側: ギャップ+傾斜+高リング）</option>
              <option value="insulator_cover">絶縁カバー付きリング</option>
            </select>
          </label>
          <span id="geo-seg-tools" class="row" style="gap:6px"></span>
        </div>
        <p class="muted" style="margin:2px 0 4px" id="geo-hint">
          セグメント（線分）をクリックして材質を選択 / 点ドラッグで移動 /
          曲線上ダブルクリックで点追加 / 点を右クリックで削除。左右の壁は鏡像対称境界。
        </p>
        <div id="geo-editor"></div>
        <details style="margin-top:6px"><summary class="muted">数値で編集（x_mm, y_mm, 次セグメントの材質 を1行に1点）</summary>
          <textarea id="geo-points-text" rows="7" style="width:100%;font-family:monospace;font-size:12px"></textarea>
        </details>`;
    } else if (group === "magnetic") {
      extra = `
        <p class="muted" style="margin:6px 0 2px">
          一様な静磁場をイオンにのみ作用させる（Boris法）。全成分0で無効。
          電子・シース構造は無磁化のまま（適用限界はモデル解説参照）。
        </p>
        <div id="mag-diagram"></div>`;
    }
    const card = document.createElement("div");
    card.className = "card config-group";
    card.innerHTML = `<details ${open}><summary>${label}</summary>
      <div class="config-grid" id="grid|${group}">${inner}</div>${extra}</details>`;
    container.appendChild(card);
  }
  if (state.model === "2d") {
    const geo = config.geometry || {};
    if (geo.points_m && geo.points_m.length >= 2 && geo.segment_materials
        && geo.segment_materials.length === geo.points_m.length - 1) {
      state.geoPoints = geo.points_m.map((p) => [p[0], p[1]]);
      state.geoMaterials = [...geo.segment_materials];
    } else {
      state.geoPoints = null;
      state.geoMaterials = null;
    }
    state.selectedSegment = null;
    renderGeometryEditor();
    syncGeoTextarea();
  }
  renderMagneticDiagram();
  updateTimeEstimate();

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
    return;
  }
  if (target.id === "geo-preset") {
    if (target.value) {
      applyGeoPreset(target.value);
      target.value = "";
    }
    return;
  }
  if (target.id === "geo-points-text") {
    parseGeoTextarea();
    return;
  }
  if (target.id && target.id.startsWith("f|geometry|")) {
    renderGeometryEditor();
  }
  if (target.id && target.id.startsWith("f|magnetic|")) {
    renderMagneticDiagram();
  }
  updateTimeEstimate();
}

function onConfigFormClick(event) {
  const button = event.target.closest("button[data-preview-group]");
  if (button) previewWaveform(button.dataset.previewGroup);
}

// ---------------- 波形・形状プレビュー ----------------

async function previewWaveform(group) {
  const statNode = document.getElementById(`wfstat|${group}`);
  try {
    const config = collectWaveformGroup(group);
    if (config.mode === "csv" && config.waveform_id === null) {
      statNode.textContent = "波形を選択またはアップロードしてください";
      return;
    }
    const payload = {
      waveform: config,
      frequency_Hz: readField("plasma", "frequency_Hz",
        state.defaults[state.model].plasma.frequency_Hz),
    };
    if (config.mode === "scaled_wafer") {
      payload.wafer_waveform = collectWaveformGroup("wafer_waveform");
    }
    const body = await api("/api/waveform-preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const div = document.getElementById(`wfprev|${group}`);
    div.classList.remove("hidden");
    linePlot(div, [{ x: body.phase_deg, y: body.voltage_V,
      name: "V(t)", line: { color: COLORS[0] } }],
      { title: "駆動波形（1周期）", xtitle: "RF phase [deg]", ytitle: "電位 [V]" });
    statNode.textContent = `min ${body.min_V.toFixed(1)} V / `
      + `max ${body.max_V.toFixed(1)} V / 平均 ${body.mean_V.toFixed(1)} V`;
  } catch (error) {
    statNode.textContent = `プレビュー失敗: ${error.message}`;
  }
}

// ---------------- 静磁場の向き図 ----------------

// 擬似3D投影でB方向を可視化する。1D: x=下向き(イオン入射)/y=右/z=紙面手前、
// 2D: x=右/y=上/z=紙面手前。zは左下向きの斜軸として描く。
function renderMagneticDiagram() {
  const div = document.getElementById("mag-diagram");
  const defaults = state.defaults[state.model];
  if (!div || !defaults || !defaults.magnetic) return;
  const read = (key) => {
    try { return readField("magnetic", key, defaults.magnetic[key]); }
    catch (_error) { return 0; }
  };
  const bx = read("bx_T"), by = read("by_T"), bz = read("bz_T");
  const mag = Math.sqrt(bx * bx + by * by + bz * bz);
  const is2d = state.model === "2d";
  const ux = is2d ? [1, 0] : [0, 1];
  const uy = is2d ? [0, -1] : [1, 0];
  const uz = [-0.55, 0.45];
  const O = [215, 118];
  const axis = (v, label) => {
    const ex = O[0] + 46 * v[0], ey = O[1] + 46 * v[1];
    // ラベルは軸の垂直方向に少しずらし、B矢印と重なっても読めるようにする
    const lx = O[0] + 60 * v[0] - 9 * v[1], ly = O[1] + 60 * v[1] + 9 * v[0];
    return `<line x1="${O[0]}" y1="${O[1]}" x2="${ex}" y2="${ey}"
      stroke="#607d8b" stroke-width="1.6" marker-end="url(#mag-ax)"/>
      <text x="${lx}" y="${ly}" fill="#607d8b" font-size="13"
        text-anchor="middle" dominant-baseline="middle">${label}</text>`;
  };
  const scene = is2d ? `
      <path d="M40 205 L110 205 L118 188 L262 188 L270 205 L340 205"
        fill="none" stroke="#90a4ae" stroke-width="2.5"/>
      <text x="44" y="224" fill="#90a4ae" font-size="11">ウェハ / リング表面</text>
      <line x1="70" y1="55" x2="70" y2="165" stroke="#1565c0"
        stroke-width="2" marker-end="url(#mag-ion)"/>
      <text x="78" y="112" fill="#1565c0" font-size="11">イオン</text>` : `
      <line x1="40" y1="34" x2="340" y2="34" stroke="#90a4ae"
        stroke-width="1.5" stroke-dasharray="6 4"/>
      <text x="44" y="26" fill="#90a4ae" font-size="11">シース端 (x = 0)</text>
      <rect x="40" y="198" width="300" height="9" fill="#90a4ae"/>
      <text x="44" y="224" fill="#90a4ae" font-size="11">電極面 (x = s_max)</text>
      <line x1="70" y1="55" x2="70" y2="160" stroke="#1565c0"
        stroke-width="2" marker-end="url(#mag-ion)"/>
      <text x="78" y="110" fill="#1565c0" font-size="11">イオン</text>`;
  let bMark;
  let caption;
  if (mag === 0) {
    bMark = `<text x="${O[0]}" y="${O[1] - 66}" fill="#7c8796" font-size="12"
      text-anchor="middle">B = 0（磁場なし）</text>`;
    caption = "全成分0のため磁場は作用しません。";
  } else {
    const dx = (bx * ux[0] + by * uy[0] + bz * uz[0]) / mag;
    const dy = (bx * ux[1] + by * uy[1] + bz * uz[1]) / mag;
    const norm = Math.sqrt(dx * dx + dy * dy);
    if (norm < 0.08) {
      // 視線方向とほぼ平行: ⊙(手前)/⊗(奥)で表す
      const sym = bz >= 0 ? "⊙" : "⊗";
      bMark = `<circle cx="${O[0]}" cy="${O[1]}" r="11" fill="none"
          stroke="#d81b60" stroke-width="2"/>
        <text x="${O[0]}" y="${O[1] + 1}" fill="#d81b60" font-size="15"
          text-anchor="middle" dominant-baseline="middle">${sym}</text>
        <text x="${O[0] + 20}" y="${O[1] - 12}" fill="#d81b60"
          font-size="14" font-weight="bold">B</text>`;
    } else {
      const ex = O[0] + 66 * dx / norm, ey = O[1] + 66 * dy / norm;
      bMark = `<line x1="${O[0]}" y1="${O[1]}" x2="${ex}" y2="${ey}"
          stroke="#d81b60" stroke-width="2.6" marker-end="url(#mag-b)"/>
        <text x="${O[0] + 80 * dx / norm}" y="${O[1] + 80 * dy / norm}"
          fill="#d81b60" font-size="14" font-weight="bold"
          text-anchor="middle" dominant-baseline="middle">B</text>`;
    }
    caption = `|B| = ${fmtNum(Number(mag.toPrecision(4)))} T　方向 (${(bx / mag).toFixed(2)}, `
      + `${(by / mag).toFixed(2)}, ${(bz / mag).toFixed(2)})`;
  }
  div.innerHTML = `
    <svg viewBox="0 0 380 235" style="max-width:400px;width:100%;display:block">
      <defs>
        <marker id="mag-ax" markerWidth="8" markerHeight="8" refX="6" refY="3"
          orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="#607d8b"/></marker>
        <marker id="mag-b" markerWidth="9" markerHeight="9" refX="7" refY="3.5"
          orient="auto"><path d="M0 0 L8 3.5 L0 7 Z" fill="#d81b60"/></marker>
        <marker id="mag-ion" markerWidth="8" markerHeight="8" refX="6" refY="3"
          orient="auto"><path d="M0 0 L7 3 L0 6 Z" fill="#1565c0"/></marker>
      </defs>
      ${scene}
      ${axis(ux, "x")}${axis(uy, "y")}${axis(uz, "z")}
      ${bMark}
    </svg>
    <p class="muted" style="margin:2px 0 0">${caption}
      （zは紙面手前向き。図では左下への斜軸として表示）</p>`;
}

// ---------------- 2Dスケッチエディタv2（セグメント材質指定・鏡像壁） ----------------

function readGeoScalar(key) {
  const defaults = state.defaults["2d"].geometry;
  try {
    return readField("geometry", key, defaults[key]);
  } catch (_error) {
    return defaults[key];
  }
}

function ensureGeoState() {
  const defaults = state.defaults["2d"].geometry;
  if (!state.geoPoints || state.geoPoints.length < 2
      || !state.geoMaterials
      || state.geoMaterials.length !== state.geoPoints.length - 1) {
    state.geoPoints = defaults.points_m.map((p) => [p[0], p[1]]);
    state.geoMaterials = [...defaults.segment_materials];
  }
}

// 非周期の表面計算（バックエンドと同一: クランプ線形補間+鏡像パディング平滑化）
function surfaceDenseV2(points, smoothing, length, n = 480) {
  const sorted = [...points].sort((a, b) => a[0] - b[0]);
  const px = sorted.map((p) => p[0]);
  const py = sorted.map((p) => p[1]);
  const interp = (x) => {
    const q = Math.min(Math.max(x, px[0]), px[px.length - 1]);
    let i = 0;
    while (i < px.length - 2 && px[i + 1] < q) i++;
    const t = (q - px[i]) / Math.max(px[i + 1] - px[i], 1e-12);
    return py[i] + t * (py[i + 1] - py[i]);
  };
  const xs = Array.from({ length: n }, (_v, i) => length * i / (n - 1));
  let ys = xs.map(interp);
  if (smoothing > 0) {
    const sigma = smoothing / (length / (n - 1));
    const half = Math.min(Math.ceil(4 * sigma), n >> 1);
    const kernel = [];
    let sum = 0;
    for (let k = -half; k <= half; k++) {
      const v = Math.exp(-0.5 * (k / sigma) ** 2);
      kernel.push(v);
      sum += v;
    }
    const mirror = (i) => {
      if (i < 0) return -i;
      if (i >= n) return 2 * (n - 1) - i;
      return i;
    };
    ys = ys.map((_v, i) => kernel.reduce((acc, kv, j) =>
      acc + kv * ys[mirror(i + j - half)], 0) / sum);
  }
  return { xs, ys };
}

function syncGeoTextarea() {
  const area = document.getElementById("geo-points-text");
  if (!area || !state.geoPoints) return;
  area.value = state.geoPoints.map((p, i) => {
    const base = `${(p[0] * 1e3).toFixed(3)}, ${(p[1] * 1e3).toFixed(3)}`;
    return i < state.geoMaterials.length
      ? `${base}, ${state.geoMaterials[i]}` : base;
  }).join("\n");
}

function parseGeoTextarea() {
  const area = document.getElementById("geo-points-text");
  if (!area) return;
  const points = [];
  const materials = [];
  for (const line of area.value.split("\n")) {
    const parts = line.split(",").map((s) => s.trim());
    if (parts.length < 2) continue;
    const x = parseFloat(parts[0]) * 1e-3;
    const y = parseFloat(parts[1]) * 1e-3;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    points.push([x, y]);
    if (parts[2] && MATERIAL_META[parts[2]]) materials.push(parts[2]);
    else materials.push("ring");
  }
  if (points.length >= 2) {
    materials.pop();   // 最終行の材質は使わない
    while (materials.length < points.length - 1) materials.push("ring");
    state.geoPoints = points;
    state.geoMaterials = materials.slice(0, points.length - 1);
    state.selectedSegment = null;
    renderGeometryEditor();
  }
}

function applyGeoPreset(name) {
  const L = readGeoScalar("domain_length_m");
  const wafer = 0.45e-3, ring = 0.25e-3;
  const presets = {
    step: {
      points: [[0, ring], [2.9e-3, ring], [3.1e-3, wafer],
               [L - 3.1e-3, wafer], [L - 2.9e-3, ring], [L, ring]],
      materials: ["ring", "wafer", "wafer", "wafer", "ring"],
    },
    taper: {
      points: [[0, ring], [2.0e-3, ring], [3.0e-3, wafer],
               [L - 3.0e-3, wafer], [L - 2.0e-3, ring], [L, ring]],
      materials: ["ring", "ring", "wafer", "ring", "ring"],
    },
    recess: {
      points: [[0, wafer], [2.9e-3, wafer], [3.1e-3, 0.55 * wafer],
               [L - 3.1e-3, 0.55 * wafer], [L - 2.9e-3, wafer], [L, wafer]],
      materials: ["ring", "wafer", "wafer", "wafer", "ring"],
    },
    // 特許型(片側): 左壁=ウェハ対称。ウェハ→ギャップ310→傾斜281→高リング280→外周段差
    patent_ring: (() => {
      const ringTop = wafer + 0.20e-3;
      const gapW = 0.25e-3, gapDepth = 0.33 * wafer;
      const rampL = 0.75e-3, lipY = wafer * 0.9;
      const stepY = ringTop - 0.10e-3, stepW = 0.60e-3;
      const right = L * 0.8125;   // L=16mmで13mm相当
      return {
        points: [[0, wafer], [right - 0.06e-3, wafer],
                 [right + 0.05e-3, gapDepth], [right + gapW, gapDepth],
                 [right + gapW + 0.07e-3, lipY],
                 [right + gapW + rampL, ringTop],
                 [L - stepW - 0.12e-3, ringTop], [L - stepW, stepY],
                 [L, stepY]],
        materials: ["wafer", "wafer", "ring", "ring", "ring", "ring",
                    "ring", "ring"],
      };
    })(),
    // 絶縁カバー付きリング: リング上面の内側半分が絶縁体で覆われている例
    insulator_cover: {
      points: [[0, wafer], [L * 0.8 - 0.1e-3, wafer],
               [L * 0.8 + 0.1e-3, 0.30e-3], [L * 0.8 + 0.3e-3, 0.30e-3],
               [L * 0.8 + 0.4e-3, 0.60e-3], [L * 0.9, 0.60e-3],
               [L * 0.9 + 0.1e-3, 0.60e-3], [L, 0.60e-3]],
      materials: ["wafer", "wafer", "ring", "insulator", "insulator",
                  "insulator", "ring"],
    },
  };
  const preset = presets[name];
  if (!preset) return;
  state.geoPoints = preset.points.map((p) => [p[0], p[1]]);
  state.geoMaterials = [...preset.materials];
  state.selectedSegment = null;
  renderGeometryEditor();
  syncGeoTextarea();
}

function renderSegmentTools() {
  const tools = document.getElementById("geo-seg-tools");
  if (!tools) return;
  if (state.selectedSegment === null || state.selectedSegment === undefined) {
    tools.innerHTML = `<span class="muted">セグメント未選択</span>`;
    return;
  }
  const current = state.geoMaterials[state.selectedSegment];
  tools.innerHTML = `<span>選択中: セグメント${state.selectedSegment + 1}</span>`
    + Object.entries(MATERIAL_META).map(([key, meta]) =>
      `<button data-set-material="${key}"
        style="border-color:${meta.color};
        ${key === current ? `background:${meta.color};color:#fff;` : `color:${meta.color};`}">
        ${meta.label}</button>`).join("");
  tools.querySelectorAll("button[data-set-material]").forEach((btn) =>
    btn.addEventListener("click", () => {
      state.geoMaterials[state.selectedSegment] = btn.dataset.setMaterial;
      renderGeometryEditor();
      syncGeoTextarea();
    }));
}

function renderGeometryEditor() {
  const host = document.getElementById("geo-editor");
  if (!host || state.model !== "2d") return;
  ensureGeoState();
  const L = readGeoScalar("domain_length_m");
  const smoothing = readGeoScalar("smoothing_m");
  const points = state.geoPoints;
  const materials = state.geoMaterials;
  // 端点をx=0/Lへ吸着
  points.sort((a, b) => a[0] - b[0]);
  points[0][0] = 0.0;
  points[points.length - 1][0] = L;

  const W = 900, H = 280, padL = 48, padR = 14, padT = 14, padB = 32;
  const sx = (m) => padL + (m / L) * (W - padL - padR);
  const yPeak = Math.max(...points.map((p) => p[1]));
  const yMax = yPeak * 1.55 + 1e-9;
  const sy = (m) => H - padB - (m / yMax) * (H - padB - padT);
  const invX = (px) => (px - padL) / (W - padL - padR) * L;
  const invY = (py) => (H - padB - py) / (H - padB - padT) * yMax;

  const dense = surfaceDenseV2(points, smoothing, L);
  let fillPath = dense.xs.map((x, i) =>
    `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(dense.ys[i]).toFixed(1)}`)
    .join("");
  fillPath += `L${sx(L)},${H - padB}L${padL},${H - padB}Z`;

  // セグメント（材質色の線分）。平滑化時も操作対象は折れ線とする
  const segments = materials.map((material, i) => {
    const meta = MATERIAL_META[material] || MATERIAL_META.ring;
    const selected = state.selectedSegment === i;
    return `<line data-segment="${i}"
      x1="${sx(points[i][0])}" y1="${sy(points[i][1])}"
      x2="${sx(points[i + 1][0])}" y2="${sy(points[i + 1][1])}"
      stroke="${meta.color}" stroke-width="${selected ? 9 : 5}"
      opacity="${selected ? 1 : 0.8}" style="cursor:pointer"/>`;
  }).join("");

  const circles = points.map((p, i) =>
    `<circle data-point="${i}" cx="${sx(p[0])}" cy="${sy(p[1])}"
      r="6.5" fill="#263238" stroke="#fff" stroke-width="2"
      style="cursor:grab"/>`).join("");

  const ticksX = [];
  const tickStep = L > 8e-3 ? 2 : 1;
  for (let mm = 0; mm <= L * 1e3 + 1e-9; mm += tickStep) {
    ticksX.push(`<line x1="${sx(mm * 1e-3)}" x2="${sx(mm * 1e-3)}"
      y1="${H - padB}" y2="${H - padB + 4}" stroke="#889"/>
      <text x="${sx(mm * 1e-3)}" y="${H - 8}" font-size="11" fill="#667"
      text-anchor="middle">${mm}</text>`);
  }
  const legend = Object.entries(MATERIAL_META).map(([_k, meta], i) =>
    `<rect x="${W - 240 + i * 78}" y="6" width="12" height="12"
       fill="${meta.color}"/>
     <text x="${W - 224 + i * 78}" y="16" font-size="11"
       fill="#445">${meta.label}</text>`).join("");

  host.innerHTML = `
  <svg id="geo-svg" viewBox="0 0 ${W} ${H}"
       style="width:100%;background:#fbfcfe;border:1px solid var(--border);
              border-radius:6px;touch-action:none;user-select:none">
    <path d="${fillPath}" fill="rgba(120,130,145,0.10)" stroke="none"/>
    <line x1="${padL}" x2="${padL}" y1="${padT}" y2="${H - padB}"
      stroke="#556" stroke-width="2" stroke-dasharray="6 4"/>
    <line x1="${sx(L)}" x2="${sx(L)}" y1="${padT}" y2="${H - padB}"
      stroke="#556" stroke-width="2" stroke-dasharray="6 4"/>
    <text x="${padL + 4}" y="${padT + 12}" font-size="11" fill="#556">対称境界</text>
    <text x="${sx(L) - 4}" y="${padT + 12}" font-size="11" fill="#556"
      text-anchor="end">対称境界</text>
    ${smoothing > 0 ? `<path d="${dense.xs.map((x, i) =>
      `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(dense.ys[i]).toFixed(1)}`)
      .join("")}" fill="none" stroke="#90a4ae" stroke-width="1.5"
      stroke-dasharray="3 3"/>` : ""}
    ${segments}${circles}${ticksX.join("")}${legend}
    <text x="${W / 2 + 30}" y="${H - 8}" font-size="11" fill="#667">x [mm]</text>
    <text x="10" y="${sy(yPeak)}" font-size="11" fill="#667">
      ${(yPeak * 1e3).toFixed(2)}mm</text>
  </svg>`;
  renderSegmentTools();

  const svg = host.querySelector("#geo-svg");
  const toLocal = (event) => {
    const rect = svg.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * W,
             y: (event.clientY - rect.top) / rect.height * H };
  };
  let drag = null;

  function refresh() {
    const d2 = surfaceDenseV2(points, smoothing, L);
    let fp = d2.xs.map((x, i) =>
      `${i ? "L" : "M"}${sx(x).toFixed(1)},${sy(d2.ys[i]).toFixed(1)}`)
      .join("");
    fp += `L${sx(L)},${H - padB}L${padL},${H - padB}Z`;
    svg.querySelector("path").setAttribute("d", fp);
    svg.querySelectorAll("line[data-segment]").forEach((line) => {
      const i = +line.dataset.segment;
      line.setAttribute("x1", sx(points[i][0]));
      line.setAttribute("y1", sy(points[i][1]));
      line.setAttribute("x2", sx(points[i + 1][0]));
      line.setAttribute("y2", sy(points[i + 1][1]));
    });
    svg.querySelectorAll("circle[data-point]").forEach((circle) => {
      const p = points[+circle.dataset.point];
      circle.setAttribute("cx", sx(p[0]));
      circle.setAttribute("cy", sy(p[1]));
    });
  }

  svg.addEventListener("pointerdown", (event) => {
    const target = event.target;
    if (target.dataset.point !== undefined) {
      drag = { index: +target.dataset.point };
      try {
        svg.setPointerCapture(event.pointerId);
      } catch (_error) { /* 合成イベントでは無視 */ }
      event.preventDefault();
    }
  });
  svg.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const local = toLocal(event);
    const i = drag.index;
    const isEndpoint = i === 0 || i === points.length - 1;
    const xm = isEndpoint ? points[i][0]
      : Math.min(Math.max(invX(local.x), 1e-6), L - 1e-6);
    const ym = Math.max(invY(local.y), 0.02e-3);
    points[i] = [xm, ym];
    refresh();
  });
  svg.addEventListener("pointerup", () => {
    if (drag) {
      drag = null;
      points.sort((a, b) => a[0] - b[0]);
      renderGeometryEditor();
      syncGeoTextarea();
    }
  });
  svg.addEventListener("click", (event) => {
    const target = event.target;
    if (target.dataset.segment !== undefined) {
      state.selectedSegment = +target.dataset.segment;
      renderGeometryEditor();
    }
  });
  svg.addEventListener("dblclick", (event) => {
    const local = toLocal(event);
    const xm = Math.min(Math.max(invX(local.x), 1e-6), L - 1e-6);
    // 追加位置のセグメントを分割し、材質を引き継ぐ
    let seg = 0;
    while (seg < points.length - 2 && points[seg + 1][0] < xm) seg++;
    const d2 = surfaceDenseV2(points, 0, L);
    const idx = Math.min(Math.round(xm / L * (d2.xs.length - 1)),
                         d2.xs.length - 1);
    points.splice(seg + 1, 0, [xm, d2.ys[idx]]);
    state.geoMaterials.splice(seg, 0, state.geoMaterials[seg]);
    state.selectedSegment = null;
    renderGeometryEditor();
    syncGeoTextarea();
  });
  svg.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (target.dataset.point === undefined) return;
    event.preventDefault();
    const i = +target.dataset.point;
    if (i === 0 || i === points.length - 1 || points.length <= 2) return;
    // 点を削除し、左右セグメントを左側の材質で統合
    points.splice(i, 1);
    state.geoMaterials.splice(i, 1);
    state.selectedSegment = null;
    renderGeometryEditor();
    syncGeoTextarea();
  });
}
function updateTimeEstimate() {
  const node = document.getElementById("time-estimate");
  if (!node) return;
  try {
    const defaults = state.defaults[state.model];
    if (!defaults) return;
    const particles = readField("tpmc", "n_particles",
      defaults.tpmc.n_particles);
    const pressures = readField("gas", "pressures_mTorr",
      defaults.gas.pressures_mTorr);
    const nPressures = Math.max(pressures.length, 1);
    let seconds;
    if (state.model === "1d") {
      seconds = 0.0004 * particles * nPressures + 3;
    } else {
      const nx = readField("field2d", "nx", defaults.field2d.nx);
      const ny = readField("field2d", "ny", defaults.field2d.ny);
      const scEnabled = readField("space_charge", "enabled",
        defaults.space_charge.enabled);
      const outers = scEnabled
        ? readField("space_charge", "outer_iterations",
            defaults.space_charge.outer_iterations) : 0;
      const deposition = scEnabled
        ? readField("space_charge", "deposition_particles",
            defaults.space_charge.deposition_particles) : 0;
      seconds = 6 * (nx * ny) / 67584
        + 0.001 * (outers * deposition + particles) * nPressures + 5;
    }
    const minutes = Math.floor(seconds / 60);
    const text = minutes >= 1
      ? `約${minutes}分${Math.round(seconds % 60)}秒`
      : `約${Math.round(seconds)}秒`;
    node.textContent = `計算時間の目安: ${text}（開発機実測基準。サーバー性能・条件により変動）`;
  } catch (_error) { /* 入力途中は無視 */ }
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
    // parseIntは指数表記("3e4")を誤読するためMath.roundで整数化する
    return Number.isInteger(defaultValue) && Number.isInteger(parsed)
      ? Math.round(parsed) : parsed;
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
  document.querySelectorAll("#config-form .input-error")
    .forEach((node) => node.classList.remove("input-error"));
  const defaults = state.defaults[state.model];
  const config = {};
  const errors = [];
  for (const [group, values] of Object.entries(defaults)) {
    if (isWaveformGroup(group)) {
      try {
        config[group] = collectWaveformGroup(group);
      } catch (error) {
        errors.push(error.message);
      }
    } else {
      config[group] = {};
      for (const [key, defaultValue] of Object.entries(values)) {
        try {
          config[group][key] = readField(group, key, defaultValue);
        } catch (error) {
          errors.push(error.message);
          const node = document.getElementById(inputId(group, key));
          if (node) node.classList.add("input-error");
        }
      }
    }
  }
  if (errors.length) {
    throw new Error(`入力を確認してください: ${errors.join(" / ")}`);
  }
  if (state.model === "2d" && config.geometry) {
    ensureGeoState();
    config.geometry.points_m = state.geoPoints.map((p) => [p[0], p[1]]);
    config.geometry.segment_materials = [...state.geoMaterials];
    if (!config.geometry.segment_materials.includes("wafer")) {
      throw new Error("ウェハ材質のセグメントが少なくとも1つ必要です。");
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
      headers: { "Content-Type": "application/json", ...adminHeaders() },
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

function showToast(text, kind, jobId) {
  const container = $("#toasts");
  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.textContent = text;
  if (jobId) {
    toast.style.cursor = "pointer";
    toast.title = "クリックで詳細を表示";
    toast.addEventListener("click", () => {
      toast.remove();
      switchTab("history");
      loadHistory().then(() => openDetail(jobId));
    });
  }
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 10000);
}

async function refreshActiveJobs() {
  try {
    const body = await api("/api/jobs?limit=20");
    for (const job of body.jobs) {
      const prev = state.lastStatuses.get(job.id);
      if (prev && ["queued", "running"].includes(prev)
          && ["done", "error", "cancelled"].includes(job.status)) {
        const name = job.label || job.id.slice(0, 8);
        if (job.status === "done") {
          showToast(`ジョブ「${name}」が完了しました`, "ok", job.id);
        } else if (job.status === "error") {
          showToast(`ジョブ「${name}」がエラーで終了しました`, "error", job.id);
        } else {
          showToast(`ジョブ「${name}」はキャンセルされました`, "warn", job.id);
        }
      }
      state.lastStatuses.set(job.id, job.status);
    }

    const active = body.jobs.filter((j) =>
      ["queued", "running"].includes(j.status));
    const container = $("#active-jobs");
    if (!active.length) {
      container.innerHTML = `<p class="muted">なし</p>`;
      return;
    }
    container.innerHTML = active.map((job) => {
      const percent = Math.round((job.progress || 0) * 100);
      const logOpen = state.openLogs.has(job.id);
      return `<div style="margin-bottom:8px">
        <div class="row">
        <span class="status-chip status-${job.status}">${job.status}</span>
        <span>${job.model.toUpperCase()} ${job.label || job.id.slice(0, 8)}</span>
        <span class="progress-outer"><span class="progress-inner"
          style="width:${percent}%"></span></span>
        <span>${percent}% ${job.progress_text || ""}</span>
        <button data-log="${job.id}">${logOpen ? "ログを閉じる" : "ログ"}</button>
        <button data-cancel="${job.id}" class="danger">キャンセル</button>
        </div>
        ${logOpen ? `<pre class="joblog" id="log|${job.id}">読み込み中...</pre>` : ""}
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
    container.querySelectorAll("button[data-log]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const id = btn.dataset.log;
        if (state.openLogs.has(id)) state.openLogs.delete(id);
        else state.openLogs.add(id);
        refreshActiveJobs();
      }));
    for (const id of state.openLogs) {
      const pre = document.getElementById(`log|${id}`);
      if (!pre) continue;
      api(`/api/jobs/${id}/log`).then((log) => {
        pre.textContent = log.log.length ? log.log.join("\n")
          : "（この計算のログ出力はまだありません）";
      }).catch(() => {});
    }
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
    <th>ユーザーID</th><th>状態</th><th>条件・結果</th><th>検証</th><th>操作</th>
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
                                 shapes = [], rangeslider = false } = {}) {
  const xaxis = { title: { text: xtitle } };
  if (rangeslider) xaxis.rangeslider = { thickness: 0.08 };
  Plotly.newPlot(div, traces, {
    ...PLOT_LAYOUT, title: { text: title, font: { size: 13 } },
    xaxis,
    yaxis: { title: { text: ytitle }, type: logy ? "log" : "linear" },
    shapes,
  }, { responsive: true, displaylogo: false });
}

// 局所極大からIEDFピークを検出する（近接5ビン以内は高い方を残す）
function findPeaks(x, y) {
  const maxY = Math.max(...y);
  if (!(maxY > 0)) return [];
  const threshold = 0.05 * maxY;
  const candidates = [];
  for (let i = 1; i < y.length - 1; i++) {
    if (y[i] >= threshold && y[i] > y[i - 1] && y[i] >= y[i + 1]) {
      candidates.push({ x: x[i], y: y[i], i });
    }
  }
  candidates.sort((a, b) => b.y - a.y);
  const kept = [];
  for (const peak of candidates) {
    if (kept.every((q) => Math.abs(q.i - peak.i) > 5)) kept.push(peak);
  }
  return kept;
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

// 検証項目の表示名・判定基準・判定関数（judge未定義=参考値）
const VALIDATION_META = {
  energy_conservation_rel_error: {
    label: "エネルギー保存 相対誤差",
    criterion: "< 1×10⁻³（静的無衝突シースで平均利得 = eVs）",
    judge: (_v, val) => val.energy_conservation_ok,
  },
  static_expected_gain_eV: { label: "静的シース期待利得 [eV]" },
  static_tpmc_gain_eV: { label: "TPMC平均利得 [eV]" },
  max_step_collision_probability: {
    label: "1ステップ最大衝突確率",
    criterion: "≤ 0.05（推奨上限。超過時はsteps_per_rf_periodを増やす）",
    judge: (_v, val) => val.collision_probability_ok,
  },
  periodic_error_V: {
    label: "Vp周期収束誤差 [V]",
    criterion: "収束許容値（既定1×10⁻⁸ V）未満",
  },
  periodic_cycles: { label: "周期定常までの周期数" },
  riley_delta_E_eV: {
    label: "Riley較正ΔE見積 [eV]",
    criterion: "参考値（正弦波近似、TPMC比0.95–1.14）",
  },
  riley_v_tilde_eff_V: { label: "実効シース電圧振幅 [V]" },
  omega_tau_ion_over_4: { label: "ωτion/4" },
  kcl_max_relative_residual: {
    label: "KCL最大相対残差",
    criterion: "< 1×10⁻⁹（回路定式化の整合）",
    judge: (v) => v < 1e-9,
  },
  partition_of_unity_error: {
    label: "Partition of unity誤差",
    criterion: "< 1×10⁻³（3基底重ね合わせの妥当性）",
    judge: (v) => v < 1e-3,
  },
  basis_scaled_residuals: { label: "基底残差（スケール済）" },
  space_charge_histories: { label: "空間電荷収束履歴 [V]" },
  space_charge_converged: {
    label: "空間電荷収束",
    criterion: "最終外部反復の変化 ≤ 5 V",
    judge: (v) => v === true,
    format: (v) => (v ? "収束" : "未収束"),
  },
  min_sheath_voltage_V: {
    label: "最小シース電圧 [V]",
    criterion: "> 0（逆シースは適用外）",
    judge: (v) => v > 0,
  },
  magnetic_field_T: { label: "静磁場強度 |B| [T]" },
  omega_ci_dt: {
    label: "ω_ci·Δt（ジャイロ位相分解能）",
    criterion: "< 0.3（超過時はsteps_per_rf_periodを増やす）",
    judge: (_v, val) => val.gyration_resolution_ok,
  },
  ion_gyroradius_m: { label: "イオンジャイロ半径 [m]" },
  gyroradius_to_sheath_ratio: {
    label: "ジャイロ半径/シース幅比",
    criterion: "参考値（≫1で弱磁化=小偏向、≲1で強磁化）",
  },
  magnetic_deflection_deg: {
    label: "磁気偏向の目安 [deg]",
    criterion: "参考値（ω_ci×通過時間）",
  },
};
const VALIDATION_SKIP = new Set(["passed", "energy_conservation_ok",
                                 "collision_probability_ok",
                                 "reverse_sheath_warning",
                                 "gyration_resolution_ok"]);

function formatValidationValue(value, meta) {
  if (meta && meta.format) return meta.format(value);
  if (typeof value === "number") {
    return Math.abs(value) < 1e-2 || Math.abs(value) > 1e4
      ? value.toExponential(3) : value.toFixed(4);
  }
  if (typeof value === "object" && value !== null) {
    return JSON.stringify(value);
  }
  return String(value);
}

function validationHtml(validation) {
  if (!validation) return "";
  const rows = Object.entries(validation)
    .filter(([key]) => !VALIDATION_SKIP.has(key))
    .map(([key, value]) => {
      const meta = VALIDATION_META[key] || { label: key };
      let verdict = null;
      if (meta.judge) {
        try {
          verdict = !!meta.judge(value, validation);
        } catch (_error) {
          verdict = null;
        }
      }
      const valueClass = verdict === false ? "val-fail" : "";
      const verdictHtml = verdict === null
        ? `<span class="muted">-</span>`
        : (verdict ? `<span class="validation-ok">合格</span>`
                   : `<span class="val-fail">不合格</span>`);
      return `<tr>
        <td>${meta.label}</td>
        <td class="num ${valueClass}">${formatValidationValue(value, meta)}</td>
        <td class="muted">${meta.criterion || "参考値"}</td>
        <td>${verdictHtml}</td></tr>`;
    }).join("");
  const badge = validation.passed
    ? `<span class="validation-ok">検証合格</span>`
    : `<span class="validation-ng">検証要確認</span>`;
  return `<div class="card"><h2>数値検証 ${badge}</h2>
    <table><thead><tr><th>項目</th><th class="num">値</th>
    <th>判定基準</th><th>判定</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

// ---------------- CSVエクスポート ----------------

function csvDownload(filename, lines) {
  // Excel対応のためBOM付きUTF-8
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")],
                        { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function exportCsv(kind, job, plots) {
  const short = job.id.slice(0, 8);
  const name = (suffix) => `bkm_${job.model}_${short}_${suffix}.csv`;
  const wf = plots.vp_waveform;
  const lines = [];
  if (kind === "waveform") {
    if (plots.model === "1d") {
      lines.push("phase_deg,V_e_driven_V,V_p_plasma_V,"
                 + "V_sp_powered_sheath_V,V_sg_ground_sheath_V");
      wf.phase_deg.forEach((p, i) => lines.push(
        `${p},${wf.V_e[i]},${wf.V_p[i]},${wf.V_sp[i]},${wf.V_sg[i]}`));
    } else {
      lines.push("phase_deg,V_w_wafer_V,V_r_ring_V,V_p_plasma_V,"
                 + "V_sw_wafer_sheath_V,V_sr_ring_sheath_V");
      wf.phase_deg.forEach((p, i) => lines.push(
        `${p},${wf.V_w[i]},${wf.V_r[i]},${wf.V_p[i]},`
        + `${wf.V_sw[i]},${wf.V_sr[i]}`));
    }
    csvDownload(name("waveforms"), lines);
  } else if (kind === "iedf") {
    if (plots.model === "1d") {
      // 全圧力で共通のエネルギー軸
      const labels = plots.iedf.map((e) => `IEDF_${e.pressure_mTorr}mTorr_1_eV`);
      lines.push(["energy_center_eV", ...labels].join(","));
      const xs = centers(plots.iedf[0].edges_eV);
      xs.forEach((x, k) => lines.push([x.toFixed(4),
        ...plots.iedf.map((e) => e.density[k].toExponential(6))].join(",")));
    } else {
      // 2Dは圧力ごとにエネルギー軸が異なるためブロック単位で出力
      for (const entry of plots.iedf) {
        lines.push(`# pressure_mTorr, ${entry.pressure_mTorr}`);
        const cols = ["energy_center_eV", "IEDF_wafer_1_eV"];
        if (entry.ring_density) cols.push("IEDF_ring_1_eV");
        if (entry.insulator_density) cols.push("IEDF_insulator_1_eV");
        lines.push(cols.join(","));
        centers(entry.edges_eV).forEach((x, k) => {
          const row = [x.toFixed(4), entry.wafer_density[k].toExponential(6)];
          if (entry.ring_density) row.push(entry.ring_density[k].toExponential(6));
          if (entry.insulator_density) {
            row.push(entry.insulator_density[k].toExponential(6));
          }
          lines.push(row.join(","));
        });
      }
    }
    csvDownload(name("iedf"), lines);
  } else if (kind === "iadf") {
    const labels = plots.iadf.map((e) => `IADF_${e.pressure_mTorr}mTorr_1_deg`);
    lines.push(["angle_deg", ...labels].join(","));
    plots.iadf[0].angle_deg.forEach((a, k) => lines.push([a.toFixed(3),
      ...plots.iadf.map((e) => e.density[k].toExponential(6))].join(",")));
    csvDownload(name("iadf"), lines);
  } else if (kind === "iaedf") {
    // 縦持ち形式（圧力・角度・エネルギー・密度）
    lines.push("pressure_mTorr,angle_center_deg,energy_center_eV,"
               + "IAEDF_1_eV_deg");
    for (const entry of plots.iaedf) {
      const angles = centers(entry.angle_edges_deg);
      const energies = centers(entry.energy_edges_eV);
      energies.forEach((energy, row) => {
        angles.forEach((angle, col) => {
          lines.push(`${entry.pressure_mTorr},${angle.toFixed(3)},`
            + `${energy.toFixed(4)},${entry.density[row][col].toExponential(6)}`);
        });
      });
    }
    csvDownload(name("iaedf"), lines);
  }
}

function detailHeaderHtml(job) {
  return `<div class="card"><h2>${job.model.toUpperCase()}:
      ${job.label || job.id.slice(0, 8)}</h2>
    <dl class="kv">
      <dt>ジョブID</dt><dd>${job.id}</dd>
      <dt>ユーザーID</dt><dd>${job.submitted_by || "-"}</dd>
      <dt>投入日時</dt><dd>${formatDate(job.created_at)}</dd>
      <dt>完了日時</dt><dd>${formatDate(job.finished_at)}</dd>
      <dt>状態</dt><dd><span class="status-chip status-${job.status}">${job.status}</span></dd>
    </dl>
    <div class="row" style="margin-top:10px">
      <button data-dl="npz">生データNPZ</button>
      <button data-dl="config">設定JSON</button>
      <button data-dl="plots">プロットJSON</button>
      <button id="reuse-config">この設定を再利用</button>
    </div>
    <div class="row" style="margin-top:6px" id="csv-export-row"></div>
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
  const fmt = (v, digits) => (v == null ? "-" : v.toFixed(digits));
  const body = rows.map((r) => `<tr>
    <td class="num">${r.pressure_mTorr}</td>
    <td class="num">${fmt(r.edge_outward_tilt_deg, 2)}</td>
    <td class="num">${fmt(r.affected_width_m == null ? null
      : r.affected_width_m * 1e3, 2)}</td>
    <td class="num">${fmt(r.wafer_mean_energy_eV, 1)}</td>
    <td class="num">${fmt(r.ring_mean_energy_eV, 1)}</td>
    <td class="num">${fmt(r.insulator_mean_energy_eV, 1)}</td>
    <td class="num">${r.n_reached}</td></tr>`).join("");
  return `<div class="card"><h2>要約（端傾き・材質別）</h2><table><thead><tr>
    <th class="num">p [mTorr]</th><th class="num">端の外向き傾き [deg]</th>
    <th class="num">影響領域幅 [mm]</th><th class="num">wafer &lt;E&gt; [eV]</th>
    <th class="num">ring &lt;E&gt; [eV]</th><th class="num">絶縁 &lt;E&gt; [eV]</th>
    <th class="num">到達数</th>
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
    let logLines = [];
    try {
      logLines = (await api(`/api/jobs/${jobId}/log`)).log || [];
    } catch (_error) { /* ログなしは許容 */ }
    renderDetail(job, plots, logLines);
    container.scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    container.innerHTML = `<div class="card"><p class="message error">${error.message}</p></div>`;
  }
}

function renderDetail(job, plots, logLines = []) {
  const container = $("#job-detail");
  state.currentValidation = job.validation;
  let html = detailHeaderHtml(job);
  if (plots) {
    html += summaryTableHtml(plots.summary_rows, plots.model);
    html += `<div class="card"><h2>プラズマ電位・シース電圧</h2>
      <div class="plot-half-wrap"><div id="plot-vp" class="plot"></div>
      <div id="plot-sheath" class="plot"></div></div></div>`;
    if (plots.model === "1d") {
      html += `<div class="card"><h2>IEDF / 符号付きIADF</h2>
        <label style="flex-direction:row;align-items:center;gap:6px">
          <input type="checkbox" id="iedf-peak-toggle"> 検出ピークマーカー（▼）を表示</label>
        <div id="plot-iedf" class="plot"></div>
        <div id="iedf-peaks"></div>
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
      html += `<div class="card"><h2>コレクタ（任意範囲のIEDF/IADF集計）</h2>
        <p class="muted">保存済みの全粒子データから、指定したx範囲に入射した
        イオンの分布を再計算なしで集計します。範囲は何度でも変更できます。</p>
        <div id="collector-list"></div>
        <div class="row" style="margin-top:8px">
          <button id="col-add">範囲を追加</button>
          <button id="col-select">フラックス図からドラッグ選択</button>
          <button id="col-eval" class="primary">集計</button>
          <button id="col-save">ジョブに保存</button>
          <button id="col-csv" disabled>CSVダウンロード</button>
          <label>圧力 <select id="col-pressure"></select></label>
        </div>
        <p id="col-message" class="message"></p>
        <div id="col-stats"></div>
        <div class="plot-half-wrap">
          <div id="col-iedf" class="plot hidden"></div>
          <div id="col-iadf" class="plot hidden"></div></div></div>`;
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
  if (logLines.length) {
    html += `<div class="card"><details><summary>実行ログ（${logLines.length}行）</summary>
      <pre class="config-view">${logLines.join("\n")}</pre></details></div>`;
  }
  html += validationHtml(job.validation);
  html += `<div class="card"><h2>設定</h2>
    <pre class="config-view">${JSON.stringify(job.config, null, 2)}</pre></div>`;
  container.innerHTML = html;

  if (plots) {
    const exportRow = container.querySelector("#csv-export-row");
    const kinds = [["waveform", "電位波形CSV"], ["iedf", "IEDF CSV"]];
    if (plots.model === "1d") kinds.push(["iadf", "IADF CSV"]);
    if (plots.iaedf && plots.iaedf.length) kinds.push(["iaedf", "IAEDF CSV"]);
    exportRow.innerHTML = `<span class="muted">CSVエクスポート:</span>`
      + kinds.map(([kind, label]) =>
        `<button data-csv="${kind}">${label}</button>`).join("");
    exportRow.querySelectorAll("button[data-csv]").forEach((btn) =>
      btn.addEventListener("click", () =>
        exportCsv(btn.dataset.csv, job, plots)));
  }

  container.querySelectorAll("button[data-dl]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      try {
        const response = await fetch(
          `/api/jobs/${job.id}/download/${btn.dataset.dl}`,
          { headers: adminHeaders() });
        if (!response.ok) throw new Error(`${response.status}`);
        const blob = await response.blob();
        const disposition = response.headers.get("content-disposition") || "";
        const match = disposition.match(/filename="?([^";]+)"?/);
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = match ? match[1]
          : `bkm_${job.id.slice(0, 8)}_${btn.dataset.dl}`;
        link.click();
        URL.revokeObjectURL(link.href);
      } catch (error) {
        window.alert(`ダウンロード失敗: ${error.message}`);
      }
    }));

  $("#reuse-config").addEventListener("click", () => {
    state.presetConfig = job.config;
    state.model = job.model;
    $("#model-select").value = job.model;
    ensureDefaults(job.model).then(() => { buildForm(); switchTab("run"); });
    setMessage("#run-message",
      `ジョブ${job.id.slice(0, 8)}の設定を読み込みました`, "ok");
  });

  if (plots) {
    drawDetailPlots(plots);
    if (plots.model === "2d") initCollectors(job);
  }
}

// ---------------- コレクタ（2D詳細画面） ----------------

function initCollectors(job) {
  state.currentJobId = job.id;
  state.collectorEval = null;
  const geo = job.config.geometry || {};
  // wafer材質の最初の連続範囲を既定コレクタにする
  let waferMin = 3e-3, waferMax = 13e-3;
  if (geo.points_m && geo.segment_materials) {
    const idx = geo.segment_materials.indexOf("wafer");
    if (idx >= 0) {
      waferMin = geo.points_m[idx][0];
      let end = idx;
      while (end < geo.segment_materials.length
             && geo.segment_materials[end] === "wafer") end++;
      waferMax = geo.points_m[end][0];
    }
  }
  const span = waferMax - waferMin;
  const defaults = [{
    label: "ウェハ中央",
    x_min_m: waferMin + 0.1 * span,
    x_max_m: waferMax - 0.1 * span,
  }];
  state.waferRange = [waferMin, waferMax];
  state.collectors = (job.collectors && job.collectors.length)
    ? job.collectors.map((c) => ({ ...c })) : defaults;
  renderCollectorList();

  $("#col-add").addEventListener("click", () => {
    state.collectors.push({
      label: `C${state.collectors.length + 1}`,
      x_min_m: waferMin,
      x_max_m: waferMax,
    });
    renderCollectorList();
    drawCollectorBands();
  });
  $("#col-select").addEventListener("click", armCollectorSelect);
  $("#col-eval").addEventListener("click", evaluateCollectors);
  $("#col-save").addEventListener("click", saveCollectors);
  $("#col-csv").addEventListener("click", downloadCollectorCsv);
  $("#col-pressure").addEventListener("change", renderCollectorResults);
  $("#collector-list").addEventListener("change", readCollectorList);
  $("#collector-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-col-del]");
    if (!button) return;
    state.collectors.splice(+button.dataset.colDel, 1);
    renderCollectorList();
    drawCollectorBands();
  });
  drawCollectorBands();
}

function renderCollectorList() {
  const container = $("#collector-list");
  if (!container) return;
  container.innerHTML = state.collectors.map((c, i) => `
    <div class="row" style="margin-bottom:4px" data-col-row="${i}">
      <span style="width:14px;height:14px;border-radius:3px;display:inline-block;
        background:${COLORS[i % COLORS.length]}"></span>
      <label>ラベル <input data-col-field="label" value="${c.label}"
        style="min-width:120px"></label>
      <label>x最小 [mm] <input data-col-field="x_min_m"
        value="${(c.x_min_m * 1e3).toFixed(3)}" style="min-width:90px"></label>
      <label>x最大 [mm] <input data-col-field="x_max_m"
        value="${(c.x_max_m * 1e3).toFixed(3)}" style="min-width:90px"></label>
      <button data-col-del="${i}" class="danger">削除</button>
    </div>`).join("");
}

function readCollectorList() {
  document.querySelectorAll("#collector-list [data-col-row]").forEach((row) => {
    const i = +row.dataset.colRow;
    const get = (field) =>
      row.querySelector(`[data-col-field="${field}"]`).value;
    state.collectors[i] = {
      label: get("label"),
      x_min_m: parseFloat(get("x_min_m")) * 1e-3,
      x_max_m: parseFloat(get("x_max_m")) * 1e-3,
    };
  });
  drawCollectorBands();
}

function armCollectorSelect() {
  const flux = document.getElementById("plot-flux");
  if (!flux || !flux.on) return;
  setMessage("#col-message",
    "フラックス図の上でドラッグして範囲を選択してください", "ok");
  Plotly.relayout(flux, { dragmode: "select" });
  const handler = (event) => {
    flux.removeAllListeners("plotly_selected");
    Plotly.relayout(flux, { dragmode: "zoom" });
    if (!event || !event.range || !event.range.x) {
      setMessage("#col-message", "", "");
      return;
    }
    const [x0, x1] = event.range.x;
    state.collectors.push({
      label: `C${state.collectors.length + 1}`,
      x_min_m: Math.min(x0, x1) * 1e-3,
      x_max_m: Math.max(x0, x1) * 1e-3,
    });
    renderCollectorList();
    drawCollectorBands();
    setMessage("#col-message",
      `範囲 ${Math.min(x0, x1).toFixed(2)}–${Math.max(x0, x1).toFixed(2)} mm を追加しました`, "ok");
  };
  flux.on("plotly_selected", handler);
}

function drawCollectorBands() {
  const flux = document.getElementById("plot-flux");
  if (!flux || !flux.layout) return;
  const bands = state.collectors.map((c, i) => ({
    type: "rect", x0: c.x_min_m * 1e3, x1: c.x_max_m * 1e3,
    yref: "paper", y0: 0, y1: 1,
    fillcolor: COLORS[i % COLORS.length], opacity: 0.13, line: { width: 0 },
  }));
  Plotly.relayout(flux, { shapes: (state.fluxBaseShapes || []).concat(bands) });
}

async function evaluateCollectors() {
  readCollectorList();
  try {
    const body = await api(
      `/api/jobs/${state.currentJobId}/collectors/evaluate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectors: state.collectors }),
      });
    state.collectorEval = body;
    const select = $("#col-pressure");
    select.innerHTML = body.pressures.map((p, i) =>
      `<option value="${i}">${p} mTorr</option>`).join("");
    $("#col-csv").disabled = false;
    renderCollectorResults();
    setMessage("#col-message", "集計しました", "ok");
  } catch (error) {
    setMessage("#col-message", `集計失敗: ${error.message}`, "error");
  }
}

function renderCollectorResults() {
  const body = state.collectorEval;
  if (!body) return;
  const pi = +($("#col-pressure").value || 0);
  const rows = body.collectors.map((c, i) => {
    const r = c.results[pi];
    return `<tr>
      <td><span style="color:${COLORS[i % COLORS.length]}">■</span>
        ${c.label || `C${i + 1}`}</td>
      <td class="num">${(c.x_min_m * 1e3).toFixed(2)}–${(c.x_max_m * 1e3).toFixed(2)}</td>
      <td class="num">${r.count}</td>
      <td class="num">${(100 * r.fraction).toFixed(1)}</td>
      <td class="num">${r.mean_energy_eV?.toFixed(1) ?? "-"}</td>
      <td class="num">${r.count ? `${r.e05_eV.toFixed(1)}–${r.e95_eV.toFixed(1)}` : "-"}</td>
      <td class="num">${r.mean_angle_deg?.toFixed(2) ?? "-"}</td>
      <td class="num">${r.mean_abs_angle_deg?.toFixed(2) ?? "-"}</td></tr>`;
  }).join("");
  $("#col-stats").innerHTML = `<table><thead><tr><th>コレクタ</th>
    <th class="num">範囲 [mm]</th><th class="num">粒子数</th>
    <th class="num">割合 [%]</th><th class="num">&lt;E&gt; [eV]</th>
    <th class="num">E05–E95 [eV]</th><th class="num">&lt;θ&gt; [deg]</th>
    <th class="num">&lt;|θ|&gt; [deg]</th></tr></thead>
    <tbody>${rows}</tbody></table>`;

  const iedfTraces = [], iadfTraces = [];
  body.collectors.forEach((c, i) => {
    const r = c.results[pi];
    if (!r.count) return;
    const color = COLORS[i % COLORS.length];
    iedfTraces.push({ x: centers(r.iedf_edges_eV), y: r.iedf_density,
      name: c.label || `C${i + 1}`, line: { color } });
    iadfTraces.push({ x: r.iadf_centers_deg, y: r.iadf_density,
      name: c.label || `C${i + 1}`, line: { color } });
  });
  const iedfDiv = document.getElementById("col-iedf");
  const iadfDiv = document.getElementById("col-iadf");
  iedfDiv.classList.remove("hidden");
  iadfDiv.classList.remove("hidden");
  linePlot(iedfDiv, iedfTraces, { title: "コレクタ別IEDF",
    xtitle: "Ion impact energy [eV]", ytitle: "IEDF [1/eV]" });
  linePlot(iadfDiv, iadfTraces, { title: "コレクタ別IADF（符号付き）",
    xtitle: "Signed angle [deg]", ytitle: "IADF [1/deg]" });
  drawCollectorBands();
}

async function saveCollectors() {
  readCollectorList();
  try {
    await api(`/api/jobs/${state.currentJobId}/collectors`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collectors: state.collectors }),
    });
    setMessage("#col-message", "コレクタ定義をジョブに保存しました", "ok");
  } catch (error) {
    setMessage("#col-message", `保存失敗: ${error.message}`, "error");
  }
}

function downloadCollectorCsv() {
  const body = state.collectorEval;
  if (!body) return;
  const pi = +($("#col-pressure").value || 0);
  const labels = body.collectors.map((c, i) => c.label || `C${i + 1}`);
  const lines = [`# pressure_mTorr, ${body.pressures[pi]}`];
  lines.push("# --- IEDF [1/eV] ---");
  lines.push(["energy_center_eV", ...labels].join(","));
  const first = body.collectors.find((c) => c.results[pi].count);
  if (first) {
    const edges = first.results[pi].iedf_edges_eV;
    for (let k = 0; k + 1 < edges.length; k++) {
      const row = [(0.5 * (edges[k] + edges[k + 1])).toFixed(4)];
      for (const c of body.collectors) {
        const r = c.results[pi];
        row.push(r.count ? r.iedf_density[k].toExponential(5) : "");
      }
      lines.push(row.join(","));
    }
    lines.push("# --- IADF [1/deg] ---");
    lines.push(["angle_center_deg", ...labels].join(","));
    const angles = first.results[pi].iadf_centers_deg;
    for (let k = 0; k < angles.length; k++) {
      const row = [angles[k].toFixed(3)];
      for (const c of body.collectors) {
        const r = c.results[pi];
        row.push(r.count ? r.iadf_density[k].toExponential(5) : "");
      }
      lines.push(row.join(","));
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `collectors_${state.currentJobId.slice(0, 8)}_`
    + `${body.pressures[pi]}mTorr.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
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

    const iedfTraces = [];
    const peakRows = [];
    const peakTraceIndices = [];
    plots.iedf.forEach((entry, i) => {
      const xs = centers(entry.edges_eV);
      const color = COLORS[i % COLORS.length];
      iedfTraces.push({ x: xs, y: entry.density,
        name: `${entry.pressure_mTorr} mTorr`, line: { color } });
      const peaks = findPeaks(xs, entry.density);
      if (peaks.length) {
        peakTraceIndices.push(iedfTraces.length);
        iedfTraces.push({
          x: peaks.map((p) => p.x), y: peaks.map((p) => p.y),
          mode: "markers", showlegend: false, visible: false,
          marker: { symbol: "triangle-down", size: 9, color },
          hovertemplate: "peak %{x:.1f} eV<extra></extra>",
        });
      }
      const top2 = peaks.slice(0, 2);
      peakRows.push({
        pressure: entry.pressure_mTorr,
        peaks: [...peaks].sort((a, b) => a.x - b.x).slice(0, 6)
          .map((p) => p.x.toFixed(1)).join(", "),
        deltaE: top2.length === 2
          ? Math.abs(top2[0].x - top2[1].x).toFixed(1) : "-",
      });
    });
    linePlot("plot-iedf", iedfTraces,
      { title: "IEDF", xtitle: "Ion impact energy [eV]",
        ytitle: "IEDF [1/eV]", rangeslider: true });
    const peakToggle = document.getElementById("iedf-peak-toggle");
    if (peakToggle) {
      peakToggle.addEventListener("change", () => {
        Plotly.restyle("plot-iedf", { visible: peakToggle.checked },
                       peakTraceIndices);
      });
    }
    const riley = state.currentValidation
      && state.currentValidation.riley_delta_E_eV;
    document.getElementById("iedf-peaks").innerHTML = `<table><thead><tr>
      <th class="num">p [mTorr]</th><th>検出ピーク [eV]</th>
      <th class="num">ΔE（2大ピーク間） [eV]</th></tr></thead><tbody>
      ${peakRows.map((r) => `<tr><td class="num">${r.pressure}</td>
        <td>${r.peaks || "-"}</td><td class="num">${r.deltaE}</td></tr>`).join("")}
      </tbody></table>
      ${riley ? `<p class="muted">参考: Riley較正ブリッジのΔE見積もり
        ${riley.toFixed(1)} eV（正弦波近似・無衝突の目安）</p>` : ""}`;

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
    const edgePositions = [];
    (geometry.wafer_ranges_mm || []).forEach(([a, b]) => {
      const lengthMm = geometry.x_mm[geometry.x_mm.length - 1];
      if (a > 1e-6) edgePositions.push(a);
      if (b < lengthMm - 1e-6) edgePositions.push(b);
    });
    const edgeShapes = edgePositions.map((x) => ({
      type: "line", x0: x, x1: x, yref: "paper", y0: 0, y1: 1,
      line: { color: "#999", width: 1, dash: "dot" },
    }));
    state.fluxBaseShapes = edgeShapes;
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
      if (entry.insulator_density) {
        iedfTraces.push({ x: centers(entry.edges_eV),
          y: entry.insulator_density,
          name: `絶縁 ${entry.pressure_mTorr} mTorr`,
          line: { color: COLORS[i % COLORS.length], dash: "dot" } });
      }
    });
    linePlot("plot-iedf", iedfTraces,
      { title: "材質別IEDF", xtitle: "Ion impact energy [eV]", ytitle: "IEDF [1/eV]" });
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
  state.compareBody = body;
  const container = $("#compare-result");
  let html = `<div class="card"><h2>IEDF比較</h2>
    <label style="flex-direction:row;align-items:center;gap:6px">
      <input type="checkbox" id="cmp-normalize"> 最大値=1で正規化</label>
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

  document.getElementById("cmp-normalize").addEventListener("change",
    (event) => drawCompareIedf(event.target.checked));
  drawCompareIedf(false);

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

function drawCompareIedf(normalize) {
  const body = state.compareBody;
  if (!body) return;
  const iedfTraces = [];
  body.jobs.forEach((job, jobIndex) => {
    (job.iedf || []).forEach((entry, pressureIndex) => {
      const color = COLORS[jobIndex % COLORS.length];
      const dashes = ["solid", "dash", "dot", "dashdot"];
      let y = entry.density || entry.wafer_density;
      if (normalize && y && y.length) {
        const maxY = Math.max(...y);
        if (maxY > 0) y = y.map((v) => v / maxY);
      }
      iedfTraces.push({
        x: centers(entry.edges_eV), y,
        name: `${job.label} ${entry.pressure_mTorr}mTorr`,
        line: { color, dash: dashes[pressureIndex % dashes.length] },
      });
    });
  });
  linePlot("cmp-iedf", iedfTraces,
    { title: "IEDF", xtitle: "Ion impact energy [eV]",
      ytitle: normalize ? "IEDF（正規化）" : "IEDF [1/eV]" });
}

// ---------------- 管理者 ----------------

function refreshAdminUi() {
  $("#admin-badge").classList.toggle("hidden", !isAdmin());
  $("#admin-login-btn").textContent = isAdmin() ? "ログアウト" : "管理者ログイン";
  // 2Dは計算・閲覧とも管理者限定: 非管理者には選択肢を表示しない
  for (const selector of ['#model-select option[value="2d"]',
                          '#filter-model option[value="2d"]']) {
    const option = document.querySelector(selector);
    if (option) {
      option.hidden = !isAdmin();
      option.disabled = !isAdmin();
    }
  }
  if (!isAdmin() && state.model === "2d") {
    state.model = "1d";
    $("#model-select").value = "1d";
    state.presetConfig = null;
    ensureDefaults("1d").then(buildForm);
  }
}

async function adminLoginToggle() {
  if (isAdmin()) {
    sessionStorage.removeItem("bkmAdminPass");
    refreshAdminUi();
    $("#job-detail").classList.add("hidden");
    loadHistory();
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
    loadHistory();
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
  $("#config-form").addEventListener("click", onConfigFormClick);
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
