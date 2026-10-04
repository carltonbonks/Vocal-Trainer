"""Build dist/: one self-contained page plus the files that make it installable."""
import hashlib
import shutil
from pathlib import Path

root = Path(__file__).parent
src, out = root / "src", root / "dist"
out.mkdir(exist_ok=True)

html = (src / "index.html").read_text()
html = html.replace("/*CORE*/", (src / "core.js").read_text())
html = html.replace("/*CSV*/", (src / "csv.js").read_text())
html = html.replace("/*SONGS*/", (src / "songs.js").read_text())
html = html.replace("/*APP*/", (src / "app.js").read_text())
(out / "index.html").write_text(html)
# Same page under a friendlier name for opening straight from disk.
(out / "vocal-trainer.html").write_text(html)

version = hashlib.sha1(html.encode()).hexdigest()[:10]
(out / "sw.js").write_text((src / "pwa/sw.js").read_text().replace("__VERSION__", version))
for name in ["manifest.webmanifest", "icon.svg", "icon-192.png", "icon-256.png", "icon-512.png"]:
    shutil.copy(src / "pwa" / name, out / name)
print(f"built dist/ (page {len(html) // 1024} KB, version {version})")

# Windows desktop bundle: the page, an icon, and a one-time setup script.
import struct
import zipfile

png = (out / "icon-256.png").read_bytes()
# An .ico file can hold a PNG directly: 6-byte header, one 16-byte entry, then the PNG.
ico = struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", 0, 0, 0, 0, 1, 32, len(png), 22) + png
readme = (
    "Vocal Trainer for Windows\r\n\r\n"
    "1. Extract this zip (right-click > Extract All).\r\n"
    "2. Double-click Install-Vocal-Trainer.bat.\r\n"
    "   If Windows shows 'Windows protected your PC', click More info > Run anyway.\r\n"
    "3. Open Vocal Trainer from the Desktop icon or the Start menu.\r\n\r\n"
    "To update, extract a newer zip over this folder and run the installer again.\r\n"
    "Your practice history is kept.\r\n\r\n"
    "Keep your practice data in the data folder: in the app, go to Progress >\r\n"
    "Your data > Choose folder and pick it. The installer files here can be\r\n"
    "replaced at any time; the data folder is never touched by updates.\r\n"
)
data_readme = (
    "Vocal Trainer saves your practice history here as CSV files once you pick\r\n"
    "this folder in the app (Progress > Your data > Choose folder).\r\n"
)
with zipfile.ZipFile(out / "vocal-trainer-windows.zip", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("VocalTrainer/vocal-trainer.html", html)
    z.writestr("VocalTrainer/vocal-trainer.ico", ico)
    z.write(src / "windows/setup.ps1", "VocalTrainer/setup.ps1")
    z.write(src / "windows/Install-Vocal-Trainer.bat", "VocalTrainer/Install-Vocal-Trainer.bat")
    z.writestr("VocalTrainer/README.txt", readme)
    z.writestr("VocalTrainer/data/README.txt", data_readme)
print("built dist/vocal-trainer-windows.zip")
