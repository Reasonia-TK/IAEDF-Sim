"""ジョブワーカー: 子プロセスでシミュレーションを実行し、結果をファイルへ書く。

DBへは触らない（進捗・結果はresult_dir内のJSONで親プロセスへ伝える）。
"""
from __future__ import annotations

import json
import os
import time
import traceback
from pathlib import Path


def _write_json_atomic(path: Path, payload: dict):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def run_job(model: str, config_json: str, data_dir: str, result_dir: str):
    """multiprocessing.Processのエントリポイント。"""
    result_path = Path(result_dir)
    result_path.mkdir(parents=True, exist_ok=True)
    progress_path = result_path / "progress.json"
    outcome_path = result_path / "outcome.json"
    log_lines: list[str] = []
    state = {"progress": 0.0, "text": "起動中", "last_write": 0.0}

    def write_progress(force=False):
        now = time.monotonic()
        if not force and now - state["last_write"] < 0.5:
            return
        state["last_write"] = now
        _write_json_atomic(progress_path, {
            "progress": state["progress"], "text": state["text"],
            "log": log_lines[-100:],
        })

    def progress_cb(fraction, text):
        state["progress"] = float(fraction)
        if text:
            state["text"] = text
        write_progress()

    def log_cb(message):
        log_lines.append(message)
        write_progress()

    try:
        # 遅延import: spawn時のトップレベルimportを軽くする
        from bkmcore.report import (build_plots_1d, build_plots_2d,
                                    save_npz_1d, save_npz_2d)
        from bkmcore.schemas import Config1D, Config2D

        config_dict = json.loads(config_json)
        write_progress(force=True)

        if model == "1d":
            config = Config1D.model_validate(config_dict)
        elif model == "2d":
            config = Config2D.model_validate(config_dict)
        else:
            raise ValueError(f"未知のモデル種別: {model}")

        xsec_text = None
        if config.gas.cross_section_source == "lxcat_phelps":
            xsec_file = Path(data_dir) / config.gas.xsec_csv_name
            if not xsec_file.is_file():
                raise FileNotFoundError(f"断面積CSVが見つかりません: {xsec_file}")
            xsec_text = xsec_file.read_text(encoding="utf-8")

        started = time.perf_counter()
        if model == "1d":
            from bkmcore.model1d.runner import run_1d
            output = run_1d(config, xsec_text=xsec_text, progress_cb=progress_cb)
            plots = build_plots_1d(output, config)
            save_npz_1d(result_path / "raw.npz", output)
        else:
            from bkmcore.model2d.runner import run_2d
            output = run_2d(config, xsec_text=xsec_text,
                            progress_cb=progress_cb, log_cb=log_cb)
            plots = build_plots_2d(output, config)
            save_npz_2d(result_path / "raw.npz", output)
        elapsed = time.perf_counter() - started

        _write_json_atomic(result_path / "plots.json", plots)
        (result_path / "config.json").write_text(
            json.dumps(config_dict, ensure_ascii=False, indent=2),
            encoding="utf-8")

        summary = {"rows": plots["summary_rows"], "scalars": plots["scalars"],
                   "elapsed_s": elapsed}
        _write_json_atomic(outcome_path, {
            "status": "done",
            "summary": summary,
            "validation": output["validation"],
            "log": log_lines,
        })
        write_progress(force=True)
    except Exception:
        _write_json_atomic(outcome_path, {
            "status": "error",
            "error": traceback.format_exc(),
            "log": log_lines,
        })
