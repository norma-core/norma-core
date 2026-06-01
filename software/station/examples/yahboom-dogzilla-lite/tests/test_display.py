from __future__ import annotations

from unittest.mock import patch

from yahboom_dogzilla_lite import display


def test_write_all_raises_when_write_makes_no_progress() -> None:
    with patch("yahboom_dogzilla_lite.display.os.write", return_value=0):
        try:
            display._write_all(1, b"x")
        except OSError as exc:
            assert "no progress" in str(exc)
        else:
            raise AssertionError("expected OSError")
