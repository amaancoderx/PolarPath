"""Products the API serves.

Kept apart from the models so the serving path can name a forecast without
importing the machinery that produced it.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date

import numpy as np


@dataclass
class Forecast:
    """One day of the forecast cycle."""

    init: date
    lead: int
    valid: date
    concentration: np.ndarray
    thickness: np.ndarray
