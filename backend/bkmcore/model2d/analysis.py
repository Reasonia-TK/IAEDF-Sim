"""2D結果の要約解析（端傾き・影響領域幅・電極別平均エネルギー）。"""
from __future__ import annotations

import numpy as np

from ..schemas import AnalysisConfig, GeometryConfig


def edge_summary(run, geo: GeometryConfig, analysis: AnalysisConfig):
    """ノートブックの表と同一定義: 外向き傾き（ウェハ中心→端方向を正）。"""
    left = geo.wafer_left_m
    right = geo.wafer_right_m
    center = 0.5 * (left + right)
    excl = analysis.edge_exclusion_m
    bin_w = analysis.bin_width_m
    edges_d = np.arange(excl, analysis.max_distance_m + bin_w, bin_w)
    centers_d = 0.5 * (edges_d[:-1] + edges_d[1:])

    xh = run["impact_x_m"]
    ang = run["angle_deg"]
    onw = run["on_wafer"] & (xh > left + excl) & (xh < right - excl)
    xw, aw = xh[onw], ang[onw]
    dist = np.minimum(xw - left, right - xw)
    outward = np.where(xw < center, -aw, aw)
    prof = np.full(centers_d.size, np.nan)
    for i in range(centers_d.size):
        m = (dist >= edges_d[i]) & (dist < edges_d[i + 1])
        if np.sum(m) >= 30:
            prof[i] = float(np.mean(outward[m]))
    edge_mask = dist <= excl + analysis.edge_band_m
    edge_tilt = float(np.mean(outward[edge_mask])) if np.any(edge_mask) else np.nan
    above = np.isfinite(prof) & (np.abs(prof) > analysis.affected_threshold_deg)
    affected = float(centers_d[np.flatnonzero(above)[-1]]) if np.any(above) else 0.0
    e_wafer = float(np.mean(run["energy_eV"][run["on_wafer"]])) \
        if np.any(run["on_wafer"]) else float("nan")
    e_ring = (float(np.mean(run["energy_eV"][~run["on_wafer"]]))
              if np.any(~run["on_wafer"]) else float("nan"))
    return {
        "edge_outward_tilt_deg": edge_tilt,
        "affected_width_m": affected,
        "wafer_mean_energy_eV": e_wafer,
        "ring_mean_energy_eV": e_ring,
        "tilt_profile_distance_m": centers_d.tolist(),
        "tilt_profile_deg": [None if not np.isfinite(v) else float(v)
                             for v in prof],
    }
