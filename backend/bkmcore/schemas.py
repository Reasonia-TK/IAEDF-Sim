"""BKM 1D/2D設定スキーマ（ノートブックの設定セルと同一構造・同一既定値）。"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


class WaveformConfig(BaseModel):
    """駆動波形設定。csvモードはAPI層でwaveform_id -> csv_textに解決される。"""
    mode: Literal["csv", "sinusoid", "scaled_wafer"] = "sinusoid"
    # --- csvモード ---
    waveform_id: Optional[int] = None    # DB登録波形への参照（アプリ用）
    csv_text: Optional[str] = None       # 解決済みCSV本文（runnerが使用）
    delimiter: str = ","
    skip_header_rows: int = 1
    x_column: int = 0
    voltage_column: int = 1
    x_axis: Literal["phase_deg", "phase_rad", "time_s", "time_ns", "time_us"] = "time_s"
    voltage_scale: float = 1.0
    voltage_offset_V: float = 0.0
    phase_offset_deg: float = 0.0
    # --- sinusoidモード: Ve = dc + amp*cos(phase + offset) ---
    sinusoid_dc_V: float = -170.0
    sinusoid_amplitude_V: float = 158.0
    sinusoid_phase_offset_deg: float = 0.0
    # --- scaled_waferモード（2Dリング専用） ---
    wafer_scale: float = 1.0
    wafer_phase_offset_deg: float = 0.0
    dc_offset_V: float = 0.0


class PlasmaConfig(BaseModel):
    frequency_Hz: float = 13.56e6
    electron_temperature_eV: float = 3.0
    sheath_edge_density_m3: float = 1.0e16
    ion_mass_amu: float = 39.948


class Circuit1DConfig(BaseModel):
    powered_to_grounded_area_ratio: float = 0.30
    grounded_electrode_voltage_V: float = 0.0
    phase_points: int = 2048
    max_cycles: int = 200
    periodic_tolerance_V: float = 1.0e-8
    capacitance_factor: float = 1.0


class SheathConfig(BaseModel):
    model: Literal["moving_front", "static_width"] = "moving_front"
    front_width_exponent: float = 0.75
    potential_exponent: float = 4.0 / 3.0


class GasConfig(BaseModel):
    gas_temperature_K: float = 300.0
    pressures_mTorr: list[float] = Field(default_factory=lambda: [0.0, 5.0, 20.0])
    cross_section_source: Literal["lxcat_phelps", "approximation"] = "lxcat_phelps"
    xsec_csv_name: str = "xsec_ar_ion_phelps_lxcat.csv"   # data/ 内のファイル名
    elastic_to_cx_ratio: float = 0.5
    cross_section_scale: float = 1.0


class TpmcConfig(BaseModel):
    n_particles: int = 30_000
    ion_temperature_eV: float = 0.05
    steps_per_rf_period: int = 400
    max_rf_periods: float = 60.0
    seed: int = 20260821
    max_recommended_collision_probability: float = 0.05


class PlotConfig(BaseModel):
    energy_bins: int = 200
    angle_bins: int = 120
    energy_max_eV: Optional[float] = None


class Config1D(BaseModel):
    waveform: WaveformConfig = Field(default_factory=WaveformConfig)
    plasma: PlasmaConfig = Field(default_factory=PlasmaConfig)
    circuit: Circuit1DConfig = Field(default_factory=Circuit1DConfig)
    sheath: SheathConfig = Field(default_factory=SheathConfig)
    gas: GasConfig = Field(default_factory=GasConfig)
    tpmc: TpmcConfig = Field(default_factory=TpmcConfig)
    plot: PlotConfig = Field(default_factory=PlotConfig)


# ---------------- 2D ----------------

class ElectrodesConfig(BaseModel):
    wafer_to_ground_area_ratio: float = 0.24
    ring_to_ground_area_ratio: float = 0.06
    ground_voltage_V: float = 0.0


class Circuit2DConfig(BaseModel):
    phase_points: int = 2048
    max_cycles: int = 200
    periodic_tolerance_V: float = 1.0e-8
    capacitance_factor: float = 1.0


class GeometryConfig(BaseModel):
    periodic_length_m: float = 16.0e-3
    wafer_left_m: float = 3.0e-3
    wafer_right_m: float = 13.0e-3
    wafer_height_m: float = 0.45e-3
    ring_height_m: float = 0.25e-3
    step_smoothing_width_m: float = 0.10e-3
    top_clearance_factor: float = 1.0


class Field2DConfig(BaseModel):
    nx: int = 384
    ny: int = 176
    sor_omega: float = 1.94
    tolerance: float = 1.0e-7
    max_iterations: int = 30_000


class SpaceChargeConfig(BaseModel):
    enabled: bool = True
    outer_iterations: int = 5
    deposition_particles: int = 25_000
    under_relaxation: float = 0.35
    density_smoothing_sigma_cells: float = 1.5
    ion_density_clip_factor: float = 2.0
    electron_phase_samples: int = 32
    max_abs_correction_V: float = 250.0
    poisson_tolerance_V: float = 5.0e-3
    poisson_max_iterations: int = 20_000


class Tpmc2DConfig(BaseModel):
    n_particles: int = 40_000
    ion_temperature_eV: float = 0.05
    steps_per_rf_period: int = 400
    max_rf_periods: float = 40.0
    seed: int = 20260821
    max_recommended_collision_probability: float = 0.05


class Gas2DConfig(GasConfig):
    pressures_mTorr: list[float] = Field(default_factory=lambda: [15.0])


class AnalysisConfig(BaseModel):
    edge_exclusion_m: float = 0.25e-3
    edge_band_m: float = 0.60e-3
    bin_width_m: float = 0.25e-3
    max_distance_m: float = 5.0e-3
    affected_threshold_deg: float = 1.0
    energy_bins: int = 160
    angle_bins: int = 120


class Config2D(BaseModel):
    wafer_waveform: WaveformConfig = Field(default_factory=lambda: WaveformConfig())
    ring_waveform: WaveformConfig = Field(default_factory=lambda: WaveformConfig())
    plasma: PlasmaConfig = Field(default_factory=PlasmaConfig)
    electrodes: ElectrodesConfig = Field(default_factory=ElectrodesConfig)
    circuit: Circuit2DConfig = Field(default_factory=Circuit2DConfig)
    geometry: GeometryConfig = Field(default_factory=GeometryConfig)
    field2d: Field2DConfig = Field(default_factory=Field2DConfig)
    space_charge: SpaceChargeConfig = Field(default_factory=SpaceChargeConfig)
    gas: Gas2DConfig = Field(default_factory=Gas2DConfig)
    tpmc: Tpmc2DConfig = Field(default_factory=Tpmc2DConfig)
    analysis: AnalysisConfig = Field(default_factory=AnalysisConfig)
