"""Write a steady voice-like A3 (220 Hz) tone with light vibrato, for Chromium's fake mic."""
import math, struct, sys, wave
sr, dur, f0 = 48000, 4.0, 220.0
out = sys.argv[1]
w = wave.open(out, "wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
ph = 0.0; frames = bytearray()
for i in range(int(sr * dur)):
    f = f0 * 2 ** ((15 / 1200) * math.sin(2 * math.pi * 5.5 * i / sr))
    ph += 2 * math.pi * f / sr
    s = sum(math.sin(h * ph) / h for h in range(1, 7)) * 0.25
    frames += struct.pack("<h", int(max(-1, min(1, s)) * 32767))
w.writeframes(bytes(frames)); w.close()
