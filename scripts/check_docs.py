#!/usr/bin/env python3
"""Check that the docs still match the code. Run with `make check-docs` (any cwd).

  1. every @mcp.tool in mcp/weave_mcp/tools/ is listed in mcp/README.md, and the tool
     counts quoted in mcp/README.md, README.md and README.ko.md equal the real count
  2. every runtime dependency in frontend/package.json, backend/pyproject.toml and
     mcp/pyproject.toml has a row in THIRD-PARTY-LICENSES.md — a Package cell may list
     several names separated by commas, and a name ending in `*` matches by prefix
  3. the en/ko document pairs (README, DEPLOY) have the same heading structure
  4. relative links in the top-level docs point at files that exist

Prints every mismatch and exits 1 if there is any. Needs Python 3.11+ (tomllib), nothing else.
"""
import functools
import glob
import json
import os
import re
import sys

try:
    import tomllib
except ImportError:  # Python < 3.11
    sys.exit("check_docs.py needs Python 3.11+ (for tomllib)")

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
problems = []


@functools.lru_cache(maxsize=None)
def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


# -- 1. MCP tools -------------------------------------------------------------------
TOOL_DEF = re.compile(
    r"@mcp\.tool\b[^\n]*\n(?:\s*@[^\n]*\n)*\s*(?:async\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\("
)
tools = set()
for path in sorted(glob.glob("mcp/weave_mcp/tools/*.py")):
    tools.update(TOOL_DEF.findall(read(path)))
count = len(tools)

for name in sorted(tools):
    if f"`{name}" not in read("mcp/README.md"):
        problems.append(f"mcp/README.md: tool `{name}` is not listed")

for path, pattern in (
    ("mcp/README.md", r"^## Tools \((\d+)\)"),
    ("README.md", r"\((\d+) tools\)"),
    ("README.ko.md", r"도구 목록\((\d+)개\)"),
):
    m = re.search(pattern, read(path), re.M)
    if not m:
        problems.append(f"{path}: could not find the MCP tool count (expected a phrase matching {pattern!r})")
    elif int(m.group(1)) != count:
        problems.append(f"{path}: says {m.group(1)} MCP tools but the code defines {count}")

# -- 2. Licenses --------------------------------------------------------------------
# The first cell of every table row lists one or more package names, comma-separated.
listed_names = set()
for line in read("THIRD-PARTY-LICENSES.md").splitlines():
    if line.startswith("|"):
        cell = line.split("|")[1]
        listed_names.update(t.strip().lower() for t in cell.split(",") if t.strip())
listed_prefixes = tuple(t[:-1] for t in listed_names if t.endswith("*"))


def listed(name):
    n = name.lower()
    return n in listed_names or n.startswith(listed_prefixes)


dependencies = [("frontend/package.json", json.load(open("frontend/package.json"))["dependencies"])]
for path in ("backend/pyproject.toml", "mcp/pyproject.toml"):
    with open(path, "rb") as f:
        specs = tomllib.load(f)["project"]["dependencies"]
    # "uvicorn[standard]>=0.41.0" -> "uvicorn"
    dependencies.append((path, [re.match(r"[A-Za-z0-9_.\-]+", spec).group(0) for spec in specs]))

for path, names in dependencies:
    for name in names:
        if not listed(name):
            problems.append(f"THIRD-PARTY-LICENSES.md: {path} dependency {name} is missing")

# -- 3. en/ko structure ---------------------------------------------------------------
def outline(path):
    # drop ``` blocks so `# comment` lines inside them are not taken for headings
    text = re.sub(r"```.*?```", "", read(path), flags=re.S)
    return [len(h) for h in re.findall(r"^(#{1,6})\s", text, re.M)]


for a, b in (("README.md", "README.ko.md"), ("DEPLOY.md", "DEPLOY.en.md")):
    if not (os.path.exists(a) and os.path.exists(b)):
        problems.append(f"{a} / {b}: one of the pair is missing")
    elif outline(a) != outline(b):
        problems.append(f"{a} ({len(outline(a))} headings) and {b} ({len(outline(b))} headings) differ in heading structure")

# -- 4. Links -------------------------------------------------------------------------
docs = sorted(set(glob.glob("*.md") + glob.glob(".github/**/*.md", recursive=True)
                  + ["frontend/README.md", "mcp/README.md"]))
for path in docs:
    base = os.path.dirname(path)
    for m in re.finditer(r'\]\(([^)]+)\)|href="([^"]+)"|src="([^"]+)"', read(path)):
        link = next(g for g in m.groups() if g)
        if link.startswith(("http://", "https://", "mailto:", "#")):
            continue
        target = os.path.normpath(os.path.join(base, link.split("#")[0]))
        if not os.path.exists(target):
            problems.append(f"{path}: link '{link}' points at a missing file")

if problems:
    print("\n".join(problems))
    print(f"\n{len(problems)} problem(s) — the docs no longer match the code.")
    sys.exit(1)
print(f"docs OK — {count} MCP tools listed, licenses complete, en/ko structure matches, links resolve")
