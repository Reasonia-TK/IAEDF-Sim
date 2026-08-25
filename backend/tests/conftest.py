import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND_DIR.parent
DATA_DIR = APP_DIR / "data"

sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture(scope="session")
def waveform_csv_text() -> str:
    path = DATA_DIR / "tailored_waveform_5harmonic.csv"
    return path.read_text(encoding="utf-8-sig")


@pytest.fixture(scope="session")
def xsec_text() -> str:
    path = DATA_DIR / "xsec_ar_ion_phelps_lxcat.csv"
    return path.read_text(encoding="utf-8")
