"""Inline src/core.js and src/app.js into one self-contained HTML file."""
from pathlib import Path

root = Path(__file__).parent
html = (root / "src/index.html").read_text()
html = html.replace("/*CORE*/", (root / "src/core.js").read_text())
html = html.replace("/*APP*/", (root / "src/app.js").read_text())
out = root / "dist/vocal-trainer.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html)
print(f"wrote {out} ({len(html) // 1024} KB)")
