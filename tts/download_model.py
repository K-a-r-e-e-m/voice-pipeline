import os
import sys
import urllib.request
import json
import time

REPO = "ehabnegm/lahgtna-omnivoice-egyptian-v3"
LOCAL_DIR = os.path.abspath("./models_cache/lahgtna-omnivoice-egyptian-v3")
os.makedirs(LOCAL_DIR, exist_ok=True)

files = [
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "chat_template.jinja",
    "train_config.json",
    "reference.wav",
    "model.safetensors"
]

def download_file(filename):
    dest = os.path.join(LOCAL_DIR, filename)
    if os.path.exists(dest) and os.path.getsize(dest) > 1000:
        print(f"[-] {filename} already exists ({os.path.getsize(dest)/1024/1024:.2f} MB). Skipping.", flush=True)
        return

    url = f"https://huggingface.co/{REPO}/resolve/main/{filename}"
    print(f"[+] Downloading {filename} from {url} ...", flush=True)
    
    start_time = time.time()
    last_print = [start_time]

    def reporthook(count, block_size, total_size):
        downloaded = count * block_size
        now = time.time()
        if now - last_print[0] > 1.5 or (total_size > 0 and downloaded >= total_size):
            last_print[0] = now
            if total_size > 0:
                pct = (downloaded / total_size) * 100
                speed = (downloaded / (now - start_time + 0.001)) / 1024 / 1024
                print(f"    {filename}: {pct:.1f}% ({downloaded/1024/1024:.1f}/{total_size/1024/1024:.1f} MB) - {speed:.2f} MB/s", flush=True)

    urllib.request.urlretrieve(url, dest, reporthook=reporthook)
    print(f"[OK] {filename} downloaded successfully!", flush=True)

for f in files:
    download_file(f)

print("[OK] All model files are ready in:", LOCAL_DIR, flush=True)
