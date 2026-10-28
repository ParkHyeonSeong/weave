# mcp/tests/test_errors_parity.py
import importlib.util
import re
from pathlib import Path

import pytest

from weave_mcp.errors import category_for_code, MCP_LOCAL_CODES

_REPO = Path(__file__).resolve().parents[2]


def _load_backend_errors():
    path = _REPO / "backend" / "core" / "errors.py"
    if not path.exists():
        pytest.skip("backend/core/errors.py not present in this checkout")
    spec = importlib.util.spec_from_file_location("weave_backend_errors", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # errors.py imports only stdlib enum — safe standalone
    return mod


def test_every_backend_code_resolves_to_its_true_category():
    be = _load_backend_errors()
    mismatches = []
    for member in be.ErrorCode:
        expected = member.category.value
        got = category_for_code(member.value)
        if got != expected:
            mismatches.append((member.value, expected, got))
    assert not mismatches, (
        "category_for_code drift — add _OVERRIDES/rule entries in weave_mcp/errors.py "
        f"for: {mismatches}"
    )


def test_mcp_local_codes_are_not_backend_codes():
    be = _load_backend_errors()
    backend_codes = {m.value for m in be.ErrorCode}
    assert MCP_LOCAL_CODES.isdisjoint(backend_codes)


def test_tool_count_is_185():
    tools_dir = _REPO / "mcp" / "weave_mcp" / "tools"
    pat = re.compile(r"^\s*@mcp\.tool\b", re.M)
    total = sum(len(pat.findall(p.read_text())) for p in tools_dir.glob("*.py"))
    assert total == 185, f"tool count changed to {total}; update the count + spec"
