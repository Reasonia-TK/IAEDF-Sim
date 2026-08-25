"""Web APIの結合テスト（実ワーカープロセスで小規模ジョブを実行）。"""
import os
import tempfile
import time
from pathlib import Path

import pytest

# api.settings はimport時に環境変数を読むため、apiのimportより前に設定する
_TMP = Path(tempfile.mkdtemp(prefix="bkm_api_test_"))
os.environ["BKM_RESULTS_DIR"] = str(_TMP / "results")
os.environ["BKM_DB_PATH"] = str(_TMP / "db" / "test.sqlite3")
os.environ["BKM_ADMIN_PASSWORD"] = "test-admin-pass"
os.environ["BKM_MAX_WORKERS"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from api.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as test_client:
        yield test_client


def small_1d_config() -> dict:
    return {
        "waveform": {"mode": "sinusoid"},
        "circuit": {"phase_points": 512},
        "gas": {"pressures_mTorr": [0.0, 5.0]},
        "tpmc": {"n_particles": 300},
    }


def wait_done(client, job_id, timeout_s=120):
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        job = client.get(f"/api/jobs/{job_id}").json()
        if job["status"] in ("done", "error", "cancelled"):
            return job
        time.sleep(0.5)
    raise TimeoutError(job_id)


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_defaults(client):
    body = client.get("/api/defaults/1d").json()
    assert body["config"]["plasma"]["electron_temperature_eV"] == 3.0
    assert "xsec_ar_ion_phelps_lxcat.csv" in body["xsec_files"]
    assert client.get("/api/defaults/2d").json()["config"]["geometry"]
    assert client.get("/api/defaults/3d").status_code == 404


def test_waveform_upload_dedup(client, waveform_csv_text):
    files = {"file": ("wave.csv", waveform_csv_text.encode("utf-8"),
                      "text/csv")}
    first = client.post("/api/waveforms", files=files).json()
    assert first["id"] > 0 and not first["duplicated"]
    second = client.post("/api/waveforms", files=files).json()
    assert second["id"] == first["id"] and second["duplicated"]
    listed = client.get("/api/waveforms").json()
    assert any(w["id"] == first["id"] for w in listed)


def test_job_lifecycle_1d(client):
    response = client.post("/api/jobs", json={
        "model": "1d", "label": "API結合テスト", "submitted_by": "pytest",
        "config": small_1d_config()})
    assert response.status_code == 200, response.text
    job_id = response.json()["id"]

    job = wait_done(client, job_id)
    assert job["status"] == "done", job.get("error")
    assert job["validation"]["passed"]
    assert job["summary"]["rows"][0]["hit_percent"] > 90

    plots = client.get(f"/api/jobs/{job_id}/plots").json()
    assert plots["model"] == "1d"
    assert len(plots["iedf"]) == 2

    for kind in ("npz", "config", "plots"):
        assert client.get(f"/api/jobs/{job_id}/download/{kind}").status_code == 200

    listed = client.get("/api/jobs", params={"q": "API結合"}).json()
    assert listed["total"] >= 1


def test_job_with_csv_waveform(client, waveform_csv_text):
    files = {"file": ("tailored.csv", waveform_csv_text.encode("utf-8"),
                      "text/csv")}
    waveform_id = client.post("/api/waveforms", files=files).json()["id"]
    config = small_1d_config()
    config["waveform"] = {"mode": "csv", "waveform_id": waveform_id,
                          "x_axis": "time_s"}
    config["gas"]["pressures_mTorr"] = [0.0]
    response = client.post("/api/jobs", json={
        "model": "1d", "label": "csv波形", "config": config})
    assert response.status_code == 200, response.text
    job = wait_done(client, response.json()["id"])
    assert job["status"] == "done", job.get("error")
    # DB保存済み設定にはcsv_text本文が含まれない
    assert job["config"]["waveform"].get("csv_text") in (None, "")


def test_csv_mode_requires_waveform(client):
    config = small_1d_config()
    config["waveform"] = {"mode": "csv"}
    response = client.post("/api/jobs", json={"model": "1d", "config": config})
    assert response.status_code == 400


def test_cancel(client):
    config = small_1d_config()
    config["tpmc"]["n_particles"] = 30_000
    config["gas"]["pressures_mTorr"] = [0.0, 5.0, 20.0]
    job_id = client.post("/api/jobs", json={
        "model": "1d", "label": "キャンセル対象", "config": config}).json()["id"]
    time.sleep(1.0)
    response = client.post(f"/api/jobs/{job_id}/cancel")
    assert response.status_code == 200
    job = wait_done(client, job_id)
    assert job["status"] == "cancelled"


def test_waveform_preview(client, waveform_csv_text):
    response = client.post("/api/waveform-preview", json={
        "waveform": {"mode": "sinusoid", "sinusoid_dc_V": -100.0,
                     "sinusoid_amplitude_V": 50.0}})
    assert response.status_code == 200
    body = response.json()
    assert len(body["phase_deg"]) == 720
    assert body["max_V"] == pytest.approx(-50.0, abs=0.5)
    assert body["min_V"] == pytest.approx(-150.0, abs=0.5)

    files = {"file": ("preview.csv", waveform_csv_text.encode("utf-8"),
                      "text/csv")}
    waveform_id = client.post("/api/waveforms", files=files).json()["id"]
    response = client.post("/api/waveform-preview", json={
        "waveform": {"mode": "csv", "waveform_id": waveform_id,
                     "x_axis": "time_s"}})
    assert response.status_code == 200
    assert response.json()["min_V"] < response.json()["max_V"]

    response = client.post("/api/waveform-preview", json={
        "waveform": {"mode": "csv"}})
    assert response.status_code == 400


def test_admin_verify(client):
    assert client.post("/api/admin/verify",
                       json={"password": "wrong"}).status_code == 401
    assert client.post("/api/admin/verify",
                       json={"password": "test-admin-pass"}).json()["ok"]


def test_delete_requires_admin(client):
    done = client.get("/api/jobs", params={"status": "done"}).json()["jobs"]
    job_id = done[0]["id"]
    assert client.delete(f"/api/jobs/{job_id}").status_code == 401
    bad = {"Authorization": "Bearer wrong"}
    assert client.delete(f"/api/jobs/{job_id}", headers=bad).status_code == 401
    good = {"Authorization": "Bearer test-admin-pass"}
    assert client.delete(f"/api/jobs/{job_id}", headers=good).status_code == 200
    # 論理削除: 一覧から消えるがDB行は残り、監査ログが記録される
    assert client.get(f"/api/jobs/{job_id}").status_code == 404
    audit = client.get("/api/audit", headers=good).json()
    assert any(a["action"] == "job_deleted" and a["target_id"] == job_id
               for a in audit)


def test_compare(client):
    done = client.get("/api/jobs", params={"status": "done"}).json()["jobs"]
    assert len(done) >= 1
    config = small_1d_config()
    config["plasma"] = {"electron_temperature_eV": 2.5}
    config["gas"]["pressures_mTorr"] = [0.0]
    second = client.post("/api/jobs", json={
        "model": "1d", "label": "比較用Te2.5", "config": config}).json()["id"]
    job = wait_done(client, second)
    assert job["status"] == "done", job.get("error")
    body = client.get("/api/compare",
                      params={"ids": f"{done[0]['id']},{second}"}).json()
    assert len(body["jobs"]) == 2
    diff_keys = [d["key"] for d in body["config_diff"]]
    assert "plasma.electron_temperature_eV" in diff_keys
