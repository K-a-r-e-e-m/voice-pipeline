import os
import sys
import torch
import soundfile as sf

sys.stdout.reconfigure(encoding='utf-8')

LOCAL_DIR = os.path.abspath("./models_cache/lahgtna-omnivoice-egyptian-v3")
print("CUDA available:", torch.cuda.is_available(), flush=True)
device = "cuda" if torch.cuda.is_available() else "cpu"
dtype = torch.float16 if torch.cuda.is_available() else torch.float32

print(f"Loading OmniVoice model from {LOCAL_DIR} on {device} ({dtype})...", flush=True)
from omnivoice.models.omnivoice import OmniVoice

model = OmniVoice.from_pretrained(LOCAL_DIR, device_map=device, dtype=dtype)
print("[OK] Model loaded successfully!", flush=True)

ref_audio = os.path.join(LOCAL_DIR, "reference.wav")
ref_text = "كان العمل التطوعي واللي لما تفتح الباب بس ليه الناس"
print(f"Using reference audio: {ref_audio}", flush=True)

test_text = "أهلا بيك، النظام شغال بموديل لهجتنا أومني فويس المصري الجديد بنجاح"
print(f"Generating test speech for: '{test_text}'...", flush=True)

import time
start_t = time.time()
audio = model.generate(
    text=test_text,
    language="arz",
    ref_audio=ref_audio,
    ref_text=ref_text,
    num_step=8
)[0]
gen_time = time.time() - start_t

out_file = "test_out.wav"
sf.write(out_file, audio, 24000)
print(f"[SUCCESS] Test speech generated in {gen_time:.2f}s! Saved to {out_file}, samples: {len(audio)} ({len(audio)/24000:.2f}s audio)", flush=True)
