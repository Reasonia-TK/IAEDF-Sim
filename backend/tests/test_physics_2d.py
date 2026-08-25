"""2D物理コアがノートブック bkm_2d_wafer_edge_ring_tpmc.ipynb と整合することの検証。"""
import numpy as np
import pytest

from bkmcore.schemas import Config2D, WaveformConfig
from bkmcore.model2d.runner import run_2d
from bkmcore.report import build_plots_2d


def reduced_config(waveform_csv_text) -> Config2D:
    """傾向確認用の縮小設定（ノートブックの「調整の目安」に準拠）。"""
    config = Config2D()
    config.wafer_waveform = WaveformConfig(mode="csv",
                                           csv_text=waveform_csv_text)
    config.ring_waveform = WaveformConfig(mode="csv",
                                          csv_text=waveform_csv_text)
    config.field2d.nx = 96
    config.field2d.ny = 48
    config.tpmc.n_particles = 1500
    config.tpmc.max_rf_periods = 40.0
    config.space_charge.deposition_particles = 1000
    config.space_charge.outer_iterations = 2
    config.circuit.phase_points = 1024
    return config


@pytest.mark.slow
class TestCircuitParity:
    """回路解は解像度に依存しないため既定設定でノートブックと比較する。"""

    def test_kcl_residual_and_convergence(self, waveform_csv_text, xsec_text):
        config = Config2D()
        config.wafer_waveform = WaveformConfig(mode="csv",
                                               csv_text=waveform_csv_text)
        config.ring_waveform = WaveformConfig(mode="csv",
                                              csv_text=waveform_csv_text)
        config.field2d.nx = 64
        config.field2d.ny = 40
        config.space_charge.enabled = False
        config.tpmc.n_particles = 200
        output = run_2d(config, xsec_text=xsec_text)
        v = output["validation"]
        # ノートブック: 周期端点のVp差 4.586e-10 V, KCL残差 4.014e-15
        assert v["periodic_error_V"] == pytest.approx(4.586e-10, rel=0.01)
        assert v["kcl_max_relative_residual"] < 1.0e-12


@pytest.fixture(scope="module")
def output(waveform_csv_text, xsec_text):
    config = reduced_config(waveform_csv_text)
    logs = []
    return run_2d(config, xsec_text=xsec_text, log_cb=logs.append), config


class TestReducedRun:

    def test_partition_of_unity(self, output):
        result, _ = output
        assert result["partition_error"] < 1.0e-3

    def test_particles_land(self, output):
        result, config = output
        run = result["results"][0]["run"]
        assert run["energy_eV"].size > 0.9 * config.tpmc.n_particles

    def test_space_charge_history_decreases(self, output):
        result, _ = output
        history = result["results"][0]["sc"]["history"]
        assert len(history) == 2
        assert history[-1] < history[0]

    def test_edge_summary_present(self, output):
        result, _ = output
        summary = result["results"][0]["summary"]
        assert np.isfinite(summary["edge_outward_tilt_deg"])
        assert np.isfinite(summary["wafer_mean_energy_eV"])

    def test_plots_json_serializable(self, output):
        import json
        result, config = output
        plots = build_plots_2d(result, config)
        text = json.dumps(plots)
        assert '"model": "2d"' in text
        assert len(plots["iedf"]) == 1
        assert plots["phi_sc"], "空間電荷マップが出力されること"
