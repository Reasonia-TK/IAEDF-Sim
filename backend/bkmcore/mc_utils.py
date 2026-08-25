"""TPMC共通ユーティリティ（1D/2Dノートブックで同一定義）。"""
from __future__ import annotations

import numpy as np


def periodic_table_at_time(table, time_s, rf_period: float):
    table = np.asarray(table)
    position = np.mod(np.asarray(time_s) / rf_period, 1.0) * table.size
    index = np.floor(position).astype(np.int64)
    fraction = position - index
    nxt = (index + 1) % table.size
    return table[index] + fraction * (table[nxt] - table[index])


def isotropic_unit_vectors(rng, size):
    cosine = 2.0 * rng.random(size) - 1.0
    sine = np.sqrt(np.maximum(1.0 - cosine**2, 0.0))
    azimuth = 2.0 * np.pi * rng.random(size)
    return np.column_stack((cosine, sine * np.cos(azimuth), sine * np.sin(azimuth)))
