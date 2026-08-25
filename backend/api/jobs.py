"""ジョブマネージャ: キュー投入・子プロセス起動・進捗監視・キャンセル。"""
from __future__ import annotations

import json
import multiprocessing as mp
import queue
import threading
import time
from pathlib import Path

from .db import Job, SessionLocal, Waveform, utcnow
from .settings import DATA_DIR, MAX_WORKERS, RESULTS_DIR
from .worker import run_job

WAVEFORM_KEYS = {"1d": ("waveform",), "2d": ("wafer_waveform", "ring_waveform")}


def resolve_waveform_csv(model: str, config_dict: dict, session) -> dict:
    """設定内のwaveform_idをDB登録済み波形のcsv_textへ解決する。"""
    for key in WAVEFORM_KEYS.get(model, ()):
        wf = config_dict.get(key)
        if not wf or wf.get("mode") != "csv":
            continue
        waveform_id = wf.get("waveform_id")
        if waveform_id is None:
            raise ValueError(f"{key}: csvモードにはwaveform_idが必要です。")
        row = session.get(Waveform, int(waveform_id))
        if row is None:
            raise ValueError(f"{key}: 波形ID {waveform_id} が見つかりません。")
        wf["csv_text"] = row.content
    return config_dict


class JobManager:
    def __init__(self, max_workers: int = MAX_WORKERS):
        self._queue: queue.Queue[str] = queue.Queue()
        self._max_workers = max(1, max_workers)
        self._running: dict[str, mp.Process] = {}
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)

    def start(self):
        self._recover_interrupted()
        self._thread.start()

    def shutdown(self):
        self._stop.set()
        with self._lock:
            for proc in self._running.values():
                if proc.is_alive():
                    proc.terminate()

    def _recover_interrupted(self):
        """前回起動時に走っていた/待っていたジョブを中断扱いにする。"""
        with SessionLocal() as session:
            stale = session.query(Job).filter(
                Job.status.in_(("queued", "running"))).all()
            for job in stale:
                job.status = "error"
                job.error_text = "サーバー再起動によりジョブが中断されました。"
                job.finished_at = utcnow()
            session.commit()

    def enqueue(self, job_id: str):
        self._queue.put(job_id)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            proc = self._running.get(job_id)
        with SessionLocal() as session:
            job = session.get(Job, job_id)
            if job is None or job.status not in ("queued", "running"):
                return False
            if proc is not None and proc.is_alive():
                proc.terminate()
            job.status = "cancelled"
            job.finished_at = utcnow()
            job.progress_text = "キャンセルされました"
            session.commit()
        return True

    def _loop(self):
        pending: list[str] = []
        while not self._stop.is_set():
            try:
                pending.append(self._queue.get(timeout=0.5))
            except queue.Empty:
                pass
            with self._lock:
                slots = self._max_workers - len(self._running)
            while slots > 0 and pending:
                job_id = pending.pop(0)
                if self._launch(job_id):
                    slots -= 1

    def _launch(self, job_id: str) -> bool:
        with SessionLocal() as session:
            job = session.get(Job, job_id)
            if job is None or job.status != "queued":
                return False
            result_dir = Path(RESULTS_DIR) / job_id
            result_dir.mkdir(parents=True, exist_ok=True)
            model = job.model
            try:
                config_dict = resolve_waveform_csv(
                    model, json.loads(job.config_json), session)
            except ValueError as exc:
                job.status = "error"
                job.error_text = str(exc)
                job.finished_at = utcnow()
                session.commit()
                return False
            config_json = json.dumps(config_dict, ensure_ascii=False)
            job.status = "running"
            job.started_at = utcnow()
            job.result_dir = str(result_dir)
            session.commit()

        proc = mp.Process(target=run_job,
                          args=(model, config_json, str(DATA_DIR),
                                str(result_dir)),
                          daemon=True)
        proc.start()
        with self._lock:
            self._running[job_id] = proc
        monitor = threading.Thread(target=self._monitor,
                                   args=(job_id, proc, result_dir), daemon=True)
        monitor.start()
        return True

    def _monitor(self, job_id: str, proc: mp.Process, result_dir: Path):
        progress_path = result_dir / "progress.json"
        outcome_path = result_dir / "outcome.json"
        while proc.is_alive():
            proc.join(timeout=1.0)
            self._sync_progress(job_id, progress_path)
        with self._lock:
            self._running.pop(job_id, None)
        self._sync_progress(job_id, progress_path)
        self._finalize(job_id, outcome_path, proc.exitcode)

    def _sync_progress(self, job_id: str, progress_path: Path):
        try:
            payload = json.loads(progress_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        with SessionLocal() as session:
            job = session.get(Job, job_id)
            if job is None or job.status != "running":
                return
            job.progress = float(payload.get("progress", 0.0))
            text = payload.get("text")
            if text:
                job.progress_text = str(text)[:300]
            session.commit()

    def _finalize(self, job_id: str, outcome_path: Path, exitcode):
        outcome = None
        try:
            outcome = json.loads(outcome_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            pass
        with SessionLocal() as session:
            job = session.get(Job, job_id)
            if job is None:
                return
            if job.status == "cancelled":
                return
            job.finished_at = utcnow()
            if outcome is not None and outcome.get("status") == "done":
                job.status = "done"
                job.progress = 1.0
                job.progress_text = "完了"
                job.summary_json = json.dumps(outcome.get("summary"),
                                              ensure_ascii=False)
                job.validation_json = json.dumps(outcome.get("validation"),
                                                 ensure_ascii=False)
            else:
                job.status = "error"
                if outcome is not None and outcome.get("error"):
                    job.error_text = str(outcome["error"])[-4000:]
                else:
                    job.error_text = (f"ワーカープロセスが異常終了しました "
                                      f"(exitcode={exitcode})。")
            session.commit()


manager = JobManager()


def wait_for_job(job_id: str, timeout_s: float = 120.0) -> str:
    """テスト用: ジョブ完了まで待つ。"""
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        with SessionLocal() as session:
            job = session.get(Job, job_id)
            if job is not None and job.status in ("done", "error", "cancelled"):
                return job.status
        time.sleep(0.5)
    raise TimeoutError(f"ジョブ{job_id}が{timeout_s}s以内に完了しませんでした。")
