"""2D物理コアがノートブック bkm_2d_wafer_edge_ring_tpmc.ipynb と整合することの検証。"""
import numpy as np
import pytest

from bkmcore.schemas import Config2D, GeometryConfig, WaveformConfig
from bkmcore.model2d.field import max_surface_height, surface_height
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


class TestProfileSurface:
    """profileモード（スケッチ表面）の検証。"""

    def profile_geo(self, smoothing=0.0) -> GeometryConfig:
        return GeometryConfig(
            surface_mode="profile", profile_smoothing_m=smoothing,
            profile_points_m=[[0.0, 0.25e-3], [3.0e-3, 0.25e-3],
                              [3.2e-3, 0.45e-3], [12.8e-3, 0.45e-3],
                              [13.0e-3, 0.25e-3]])

    def test_interpolates_control_points(self):
        geo = self.profile_geo()
        xs = np.array([0.0, 3.0e-3, 3.2e-3, 8.0e-3, 12.8e-3])
        expected = np.array([0.25e-3, 0.25e-3, 0.45e-3, 0.45e-3, 0.45e-3])
        assert np.allclose(surface_height(xs, geo), expected, atol=1e-9)

    def test_periodic_wrap(self):
        geo = self.profile_geo()
        # 最終点(13mm,0.25mm)から先頭点(0mm,0.25mm)へ周期補間
        assert surface_height(14.5e-3, geo) == pytest.approx(0.25e-3, abs=1e-9)
        assert surface_height(16.0e-3, geo) == pytest.approx(
            float(surface_height(0.0, geo)), abs=1e-12)

    def test_smoothing_preserves_scale(self):
        sharp = self.profile_geo(smoothing=0.0)
        smooth = self.profile_geo(smoothing=0.2e-3)
        xs = np.linspace(0.0, 16.0e-3, 500, endpoint=False)
        h_sharp = surface_height(xs, sharp)
        h_smooth = surface_height(xs, smooth)
        assert abs(np.mean(h_smooth) - np.mean(h_sharp)) < 1e-6
        assert h_smooth.min() >= h_sharp.min() - 1e-9
        assert h_smooth.max() <= h_sharp.max() + 1e-9

    def test_max_surface_height(self):
        assert max_surface_height(self.profile_geo()) == pytest.approx(
            0.45e-3, abs=1e-8)

    def test_validation_rejects_bad_points(self):
        with pytest.raises(ValueError):
            GeometryConfig(surface_mode="profile",
                           profile_points_m=[[0.0, 1e-3], [1e-3, 1e-3]])
        with pytest.raises(ValueError):
            GeometryConfig(surface_mode="profile",
                           profile_points_m=[[0.0, 1e-3], [1e-3, -1e-3],
                                             [2e-3, 1e-3]])

    def test_reduced_run_with_profile(self, waveform_csv_text, xsec_text):
        config = reduced_config(waveform_csv_text)
        config.geometry = self.profile_geo(smoothing=0.1e-3)
        config.space_charge.enabled = False
        config.tpmc.n_particles = 800
        output = run_2d(config, xsec_text=xsec_text)
        assert output["partition_error"] < 1.0e-3
        run = output["results"][0]["run"]
        assert run["energy_eV"].size > 0.9 * 800
        assert np.isfinite(
            output["results"][0]["summary"]["wafer_mean_energy_eV"])


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
