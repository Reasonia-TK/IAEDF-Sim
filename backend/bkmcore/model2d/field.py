"""2D形状（ウェハ+エッジリング段差）とLaplace 3基底（赤黒SOR）。"""
from __future__ import annotations

import numpy as np

from ..schemas import Field2DConfig, GeometryConfig


# profileモードの密表面テーブルキャッシュ（設定内容をキーに再利用）
_PROFILE_TABLE_N = 4096
_profile_cache: dict = {}


def _profile_table(geo: GeometryConfig):
    key = (tuple(tuple(p) for p in geo.profile_points_m),
           geo.profile_smoothing_m, geo.periodic_length_m)
    cached = _profile_cache.get(key)
    if cached is not None:
        return cached
    points = np.asarray(sorted(geo.profile_points_m, key=lambda p: p[0]),
                        dtype=float)
    px, py = points[:, 0], points[:, 1]
    length = geo.periodic_length_m
    # 周期線形補間（端点は周期でラップ）
    px_ext = np.r_[px, px[0] + length]
    py_ext = np.r_[py, py[0]]
    grid = np.arange(_PROFILE_TABLE_N) * length / _PROFILE_TABLE_N
    q = np.where(grid < px_ext[0], grid + length, grid)
    table = np.interp(q, px_ext, py_ext)
    if geo.profile_smoothing_m > 0.0:
        sigma_cells = geo.profile_smoothing_m / (length / _PROFILE_TABLE_N)
        half = int(np.ceil(4.0 * sigma_cells))
        kernel = np.exp(-0.5 * (np.arange(-half, half + 1) / sigma_cells) ** 2)
        kernel /= kernel.sum()
        table = np.convolve(np.r_[table[-half:], table, table[:half]],
                            kernel, mode="same")[half:-half]
    if len(_profile_cache) > 16:
        _profile_cache.clear()
    _profile_cache[key] = table
    return table


def _profile_nodes(geo: GeometryConfig):
    key = ("nodes", tuple(tuple(p) for p in geo.profile_points_m),
           geo.periodic_length_m)
    cached = _profile_cache.get(key)
    if cached is not None:
        return cached
    points = np.asarray(sorted(geo.profile_points_m, key=lambda p: p[0]),
                        dtype=float)
    px_ext = np.r_[points[:, 0], points[0, 0] + geo.periodic_length_m]
    py_ext = np.r_[points[:, 1], points[0, 1]]
    _profile_cache[key] = (px_ext, py_ext)
    return px_ext, py_ext


def surface_height(x, geo: GeometryConfig):
    q = np.mod(np.asarray(x, dtype=float), geo.periodic_length_m)
    if geo.surface_mode == "profile":
        if geo.profile_smoothing_m <= 0.0:
            # 平滑化なしは制御点を厳密に通る周期線形補間
            px_ext, py_ext = _profile_nodes(geo)
            qq = np.where(q < px_ext[0], q + geo.periodic_length_m, q)
            return np.interp(qq, px_ext, py_ext)
        table = _profile_table(geo)
        position = q / geo.periodic_length_m * _PROFILE_TABLE_N
        index = np.floor(position).astype(np.int64) % _PROFILE_TABLE_N
        fraction = position - np.floor(position)
        nxt = (index + 1) % _PROFILE_TABLE_N
        return table[index] + fraction * (table[nxt] - table[index])
    left, right = geo.wafer_left_m, geo.wafer_right_m
    width = max(geo.step_smoothing_width_m, 1e-12)
    window = 0.5 * (np.tanh((q - left) / width) - np.tanh((q - right) / width))
    return geo.ring_height_m + (geo.wafer_height_m - geo.ring_height_m) * window


def max_surface_height(geo: GeometryConfig) -> float:
    sample = np.arange(2048) * geo.periodic_length_m / 2048
    return float(np.max(surface_height(sample, geo)))


def is_wafer(x, geo: GeometryConfig):
    q = np.mod(np.asarray(x, dtype=float), geo.periodic_length_m)
    return (q >= geo.wafer_left_m) & (q <= geo.wafer_right_m)


def solve_basis(kind: str, geo: GeometryConfig, f2d: Field2DConfig,
                domain_top: float):
    nx, ny = int(f2d.nx), int(f2d.ny)
    length = geo.periodic_length_m
    x = np.arange(nx) * length / nx
    s = surface_height(x, geo)
    y = np.linspace(0.0, domain_top, ny)
    dx = length / nx
    dy = y[1] - y[0]
    X, Y = np.meshgrid(x, y)

    conductor = Y <= s[None, :]
    plasma_top = np.zeros_like(conductor)
    plasma_top[-1] = True
    active = ~conductor & ~plasma_top
    wafer_cols = np.broadcast_to(is_wafer(x, geo)[None, :], X.shape)

    fixed = np.zeros_like(X)
    if kind == "plasma":
        fixed[-1] = 1.0
    elif kind == "wafer":
        fixed[conductor & wafer_cols] = 1.0
    elif kind == "ring":
        fixed[conductor & ~wafer_cols] = 1.0
    else:
        raise ValueError(kind)

    psi = np.zeros_like(X)
    psi[~active] = fixed[~active]
    jj, ii = np.indices(psi.shape)
    red = active & (((ii + jj) & 1) == 0)
    black = active & ~red
    idx2, idy2 = 1.0 / dx**2, 1.0 / dy**2
    den = 2.0 * (idx2 + idy2)
    omega_sor = f2d.sor_omega

    iteration = 0
    for iteration in range(1, int(f2d.max_iterations) + 1):
        update = 0.0
        for mask in (red, black):
            east = np.roll(psi, -1, axis=1)
            west = np.roll(psi, 1, axis=1)
            north = np.roll(psi, -1, axis=0)
            south = np.roll(psi, 1, axis=0)
            gs = ((east + west) * idx2 + (north + south) * idy2) / den
            new = (1.0 - omega_sor) * psi[mask] + omega_sor * gs[mask]
            update = max(update, float(np.max(np.abs(new - psi[mask]))))
            psi[mask] = new
        if update < f2d.tolerance:
            break

    east = np.roll(psi, -1, axis=1)
    west = np.roll(psi, 1, axis=1)
    lap = (east - 2 * psi + west) * idx2
    lap[1:-1] += (psi[2:] - 2 * psi[1:-1] + psi[:-2]) * idy2
    residual = float(np.max(np.abs(lap[active])) * domain_top**2)
    ex = -(np.roll(psi, -1, axis=1) - np.roll(psi, 1, axis=1)) / (2 * dx)
    ey = -np.gradient(psi, dy, axis=0, edge_order=2)
    ex[conductor] = 0.0
    ey[conductor] = 0.0
    return {"psi": psi, "Ex": ex, "Ey": ey, "x": x, "y": y, "surface": s,
            "conductor": conductor, "active": active, "dx": dx, "dy": dy,
            "iterations": iteration, "residual": residual}


def build_basis(geo: GeometryConfig, f2d: Field2DConfig, domain_top: float):
    basis = {name: solve_basis(name, geo, f2d, domain_top)
             for name in ("plasma", "wafer", "ring")}
    field = basis["plasma"]
    partition = (basis["plasma"]["psi"] + basis["wafer"]["psi"]
                 + basis["ring"]["psi"])
    partition_error = float(np.max(np.abs(partition[field["active"]] - 1.0)))
    return basis, partition_error
