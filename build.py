"""Build dist/: one self-contained page plus the files that make it installable."""
import hashlib
import shutil
from pathlib import Path

root = Path(__file__).parent
src, out = root / "src", root / "dist"
out.mkdir(exist_ok=True)

html = (src / "index.html").read_text()
html = html.replace("/*CORE*/", (src / "core.js").read_text())
html = html.replace("/*APP*/", (src / "app.js").read_text())
(out / "index.html").write_text(html)
# Same page under a friendlier name for opening straight from disk.
(out / "vocal-trainer.html").write_text(html)

version = hashlib.sha1(html.encode()).hexdigest()[:10]
(out / "sw.js").write_text((src / "pwa/sw.js").read_text().replace("__VERSION__", version))
for name in ["manifest.webmanifest", "icon.svg"]:
    shutil.copy(src / "pwa" / name, out / name)
print(f"built dist/ (page {len(html) // 1024} KB, version {version}); run render_icons.js for PNG icons")
