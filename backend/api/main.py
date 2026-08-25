"""BKM IEDF/IADFシミュレーター Web API。"""
from __future__ import annotations

import hashlib
import json
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import (Depends, FastAPI, File, Form, HTTPException, Query,
                     UploadFile)
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy import desc
from sqlalchemy.orm import Session

from bkmcore.schemas import Config1D, Config2D

from .auth import check_admin_password, require_admin
from .db import AuditLog, Job, Waveform, get_session, utcnow
from .jobs import manager
from .settings import DATA_DIR, FRONTEND_DIR


@asynccontextmanager
async def lifespan(_app: FastAPI):
    manager.start()
    yield
    manager.shutdown()


app = FastAPI(title="BKM IEDF/IADF Simulator", lifespan=lifespan)


# ---------------- スキーマ ----------------

class JobCreateRequest(BaseModel):
    model: str                       # "1d" / "2d"
    label: str = ""
    submitted_by: str = ""
    config: dict


class AdminVerifyRequest(BaseModel):
    password: str


class WaveformPreviewRequest(BaseModel):
    waveform: dict
    wafer_waveform: Optional[dict] = None    # scaled_wafer用の参照波形
    frequency_Hz: float = 13.56e6


def job_to_dict(job: Job, *, with_detail=False) -> dict:
    row = {
        "id": job.id,
        "model": job.model,
        "label": job.label,
        "submitted_by": job.submitted_by,
        "status": job.status,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "started_at": job.started_at.isoformat() if job.started_at else None,
        "finished_at": job.finished_at.isoformat() if job.finished_at else None,
        "progress": job.progress,
        "progress_text": job.progress_text,
        "deleted": job.deleted,
        "summary": json.loads(job.summary_json) if job.summary_json else None,
        "validation": (json.loads(job.validation_json)
                       if job.validation_json else None),
        "error": job.error_text,
    }
    if with_detail:
        row["config"] = json.loads(job.config_json)
    return row


# ---------------- 基本 ----------------

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/defaults/{model}")
def defaults(model: str):
    if model == "1d":
        config = Config1D().model_dump()
    elif model == "2d":
        config = Config2D().model_dump()
    else:
        raise HTTPException(404, "modelは1d/2d")
    xsec_files = sorted(p.name for p in DATA_DIR.glob("xsec_*.csv"))
    return {"config": config, "xsec_files": xsec_files}


@app.post("/api/admin/verify")
def admin_verify(request: AdminVerifyRequest):
    if not check_admin_password(request.password):
        raise HTTPException(401, "管理者パスワードが違います。")
    return {"ok": True}


# ---------------- 波形 ----------------

@app.post("/api/waveforms")
async def upload_waveform(file: UploadFile = File(...),
                          name: str = Form(default=""),
                          session: Session = Depends(get_session)):
    raw = await file.read()
    if len(raw) > 5_000_000:
        raise HTTPException(413, "波形CSVが大きすぎます（5MB上限）。")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            text = raw.decode("cp932")
        except UnicodeDecodeError:
            raise HTTPException(400, "CSVの文字コードを解釈できません"
                                     "（UTF-8/CP932に対応）。")
    sha = hashlib.sha256(text.encode("utf-8")).hexdigest()
    existing = session.query(Waveform).filter(Waveform.sha256 == sha).first()
    if existing is not None:
        return {"id": existing.id, "name": existing.name,
                "sha256": existing.sha256, "duplicated": True}
    waveform = Waveform(name=name or (file.filename or "waveform.csv"),
                        sha256=sha, content=text)
    session.add(waveform)
    session.commit()
    return {"id": waveform.id, "name": waveform.name,
            "sha256": waveform.sha256, "duplicated": False}


@app.post("/api/waveform-preview")
def waveform_preview(request: WaveformPreviewRequest,
                     session: Session = Depends(get_session)):
    """フォーム設定の波形を1周期サンプリングして返す（実行前プレビュー用）。"""
    import numpy as np

    from bkmcore.schemas import WaveformConfig
    from bkmcore.waveform import make_waveform_function

    omega = 2.0 * np.pi * request.frequency_Hz

    def build(config_dict, wafer_func=None):
        config = WaveformConfig.model_validate(config_dict)
        if config.mode == "csv":
            if config.waveform_id is None:
                raise HTTPException(400, "csvモードには波形の選択が必要です。")
            row = session.get(Waveform, int(config.waveform_id))
            if row is None:
                raise HTTPException(404, f"波形ID {config.waveform_id} が見つかりません。")
            config.csv_text = row.content
        try:
            return make_waveform_function(config, omega, wafer_func=wafer_func)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(400, f"波形を解釈できません: {exc}")

    wafer_func = None
    if request.wafer_waveform is not None:
        wafer_func = build(request.wafer_waveform)
    func = build(request.waveform, wafer_func=wafer_func)
    phase = np.linspace(0.0, 2.0 * np.pi, 720, endpoint=False)
    voltage = np.asarray(func(phase), dtype=float)
    return {"phase_deg": np.degrees(phase).tolist(),
            "voltage_V": voltage.tolist(),
            "min_V": float(voltage.min()), "max_V": float(voltage.max()),
            "mean_V": float(voltage.mean())}


@app.get("/api/waveforms")
def list_waveforms(session: Session = Depends(get_session)):
    rows = session.query(Waveform).filter(~Waveform.deleted) \
        .order_by(desc(Waveform.created_at)).all()
    return [{"id": w.id, "name": w.name, "sha256": w.sha256[:12],
             "created_at": w.created_at.isoformat()} for w in rows]


# ---------------- ジョブ ----------------

@app.post("/api/jobs")
def create_job(request: JobCreateRequest,
               session: Session = Depends(get_session)):
    if request.model not in ("1d", "2d"):
        raise HTTPException(400, "modelは1d/2d")
    schema = Config1D if request.model == "1d" else Config2D
    try:
        config = schema.model_validate(request.config)
    except Exception as exc:
        raise HTTPException(400, f"設定が不正です: {exc}")
    config_dict = config.model_dump()
    # DBにはcsv_text本文は保存しない（waveformsテーブルにidで紐づく）
    for key in ("waveform", "wafer_waveform", "ring_waveform"):
        if key in config_dict and config_dict[key]:
            config_dict[key].pop("csv_text", None)
            wf = config_dict[key]
            if wf.get("mode") == "csv" and wf.get("waveform_id") is None:
                raise HTTPException(
                    400, f"{key}: csvモードには波形のアップロード/選択が必要です。")
    xsec_name = Path(config_dict["gas"]["xsec_csv_name"]).name
    config_dict["gas"]["xsec_csv_name"] = xsec_name
    if (config_dict["gas"]["cross_section_source"] == "lxcat_phelps"
            and not (DATA_DIR / xsec_name).is_file()):
        raise HTTPException(400, f"断面積CSVが見つかりません: {xsec_name}")

    job = Job(id=str(uuid.uuid4()), model=request.model,
              label=request.label[:200],
              submitted_by=request.submitted_by[:100],
              config_json=json.dumps(config_dict, ensure_ascii=False))
    session.add(job)
    session.commit()
    manager.enqueue(job.id)
    return job_to_dict(job)


@app.get("/api/jobs")
def list_jobs(model: Optional[str] = None, status: Optional[str] = None,
              q: Optional[str] = None, include_deleted: bool = False,
              limit: int = Query(default=50, le=500), offset: int = 0,
              session: Session = Depends(get_session)):
    query = session.query(Job)
    if not include_deleted:
        query = query.filter(~Job.deleted)
    if model:
        query = query.filter(Job.model == model)
    if status:
        query = query.filter(Job.status == status)
    if q:
        like = f"%{q}%"
        query = query.filter(Job.label.like(like)
                             | Job.submitted_by.like(like)
                             | Job.id.like(like))
    total = query.count()
    rows = query.order_by(desc(Job.created_at)).offset(offset).limit(limit).all()
    return {"total": total, "jobs": [job_to_dict(j) for j in rows]}


def get_job_or_404(job_id: str, session: Session, *,
                   allow_deleted=False) -> Job:
    job = session.get(Job, job_id)
    if job is None or (job.deleted and not allow_deleted):
        raise HTTPException(404, "ジョブが見つかりません。")
    return job


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, session: Session = Depends(get_session)):
    return job_to_dict(get_job_or_404(job_id, session), with_detail=True)


@app.get("/api/jobs/{job_id}/plots")
def get_job_plots(job_id: str, session: Session = Depends(get_session)):
    job = get_job_or_404(job_id, session)
    if job.status != "done" or not job.result_dir:
        raise HTTPException(409, f"ジョブは未完了です (status={job.status})。")
    path = Path(job.result_dir) / "plots.json"
    if not path.is_file():
        raise HTTPException(404, "プロットデータが見つかりません。")
    return FileResponse(path, media_type="application/json")


@app.get("/api/jobs/{job_id}/log")
def get_job_log(job_id: str, session: Session = Depends(get_session)):
    job = get_job_or_404(job_id, session)
    if not job.result_dir:
        return {"log": []}
    for name in ("outcome.json", "progress.json"):
        path = Path(job.result_dir) / name
        if path.is_file():
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                return {"log": payload.get("log", [])}
            except (OSError, json.JSONDecodeError):
                continue
    return {"log": []}


@app.get("/api/jobs/{job_id}/download/{kind}")
def download(job_id: str, kind: str, session: Session = Depends(get_session)):
    job = get_job_or_404(job_id, session)
    if not job.result_dir:
        raise HTTPException(404, "結果ファイルがありません。")
    files = {"npz": ("raw.npz", "application/octet-stream"),
             "config": ("config.json", "application/json"),
             "plots": ("plots.json", "application/json")}
    if kind not in files:
        raise HTTPException(404, "kindはnpz/config/plots")
    name, media = files[kind]
    path = Path(job.result_dir) / name
    if not path.is_file():
        raise HTTPException(404, f"{name}が見つかりません。")
    short = job.id[:8]
    return FileResponse(path, media_type=media,
                        filename=f"bkm_{job.model}_{short}_{name}")


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str, session: Session = Depends(get_session)):
    get_job_or_404(job_id, session)
    if not manager.cancel(job_id):
        raise HTTPException(409, "実行中/待機中のジョブではありません。")
    return {"ok": True}


@app.delete("/api/jobs/{job_id}", dependencies=[Depends(require_admin)])
def delete_job(job_id: str, session: Session = Depends(get_session)):
    """管理者のみ: 論理削除（DB記録は残し、結果ファイルを物理削除）。"""
    job = get_job_or_404(job_id, session)
    if job.status in ("queued", "running"):
        raise HTTPException(409, "実行中のジョブは先にキャンセルしてください。")
    job.deleted = True
    job.deleted_at = utcnow()
    if job.result_dir and Path(job.result_dir).is_dir():
        shutil.rmtree(job.result_dir, ignore_errors=True)
    session.add(AuditLog(action="job_deleted", target_type="job",
                         target_id=job.id,
                         detail=f"model={job.model} label={job.label}"))
    session.commit()
    return {"ok": True}


@app.get("/api/audit", dependencies=[Depends(require_admin)])
def audit_log(limit: int = Query(default=100, le=1000),
              session: Session = Depends(get_session)):
    rows = session.query(AuditLog).order_by(desc(AuditLog.ts)).limit(limit).all()
    return [{"ts": r.ts.isoformat(), "action": r.action,
             "target_type": r.target_type, "target_id": r.target_id,
             "detail": r.detail} for r in rows]


# ---------------- 比較 ----------------

def _flatten(d: dict, prefix="") -> dict:
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(_flatten(v, key + "."))
        else:
            out[key] = v
    return out


@app.get("/api/compare")
def compare(ids: str, session: Session = Depends(get_session)):
    id_list = [i for i in ids.split(",") if i]
    if not 2 <= len(id_list) <= 6:
        raise HTTPException(400, "比較は2〜6件のジョブを指定してください。")
    entries = []
    flats = []
    for job_id in id_list:
        job = get_job_or_404(job_id, session)
        if job.status != "done" or not job.result_dir:
            raise HTTPException(409, f"ジョブ{job_id[:8]}は未完了です。")
        path = Path(job.result_dir) / "plots.json"
        if not path.is_file():
            raise HTTPException(404, f"ジョブ{job_id[:8]}のプロットが見つかりません。")
        plots = json.loads(path.read_text(encoding="utf-8"))
        config = json.loads(job.config_json)
        flats.append(_flatten(config))
        entries.append({
            "id": job.id, "label": job.label or job.id[:8],
            "model": job.model,
            "created_at": job.created_at.isoformat(),
            "iedf": plots.get("iedf", []),
            "iadf": plots.get("iadf", []),
            "summary_rows": plots.get("summary_rows", []),
        })
    keys = sorted(set().union(*[set(f) for f in flats]))
    diff = []
    for key in keys:
        values = [f.get(key) for f in flats]
        if any(v != values[0] for v in values[1:]):
            diff.append({"key": key, "values": values})
    return {"jobs": entries, "config_diff": diff}


# ---------------- 静的フロントエンド ----------------

if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True),
              name="frontend")
