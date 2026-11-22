import os
import sys
import time
import httpx
from concurrent.futures import ThreadPoolExecutor

REPO = "eustlb/higgs-audio-v2-tokenizer"
LOCAL_DIR = os.path.expanduser(r"~\.cache\huggingface\hub\models--eustlb--higgs-audio-v2-tokenizer\snapshots\528e871c2a26c4f0f7773b9754e2e1acae20899d")
os.makedirs(LOCAL_DIR, exist_ok=True)

# Also create local cache copy
LOCAL_DIR_2 = os.path.abspath("./models_cache/higgs-audio-v2-tokenizer")
os.makedirs(LOCAL_DIR_2, exist_ok=True)

small_files = ["config.json", "preprocessor_config.json", "README.md"]
for sf_name in small_files:
    u = f"https://huggingface.co/{REPO}/resolve/main/{sf_name}"
    for d in [LOCAL_DIR, LOCAL_DIR_2]:
        dest_sf = os.path.join(d, sf_name)
        if not os.path.exists(dest_sf):
            try:
                with httpx.Client(follow_redirects=True, timeout=30.0) as cl:
                    resp = cl.get(u)
                    with open(dest_sf, "wb") as f:
                        f.write(resp.content)
            except Exception as e:
                print(f"Error downloading {sf_name}: {e}")

filename = "model.safetensors"
dest = os.path.join(LOCAL_DIR, filename)
url = f"https://huggingface.co/{REPO}/resolve/main/{filename}"

print(f"Resolving URL for {url} ...", flush=True)

with httpx.Client(follow_redirects=True, timeout=30.0) as client:
    resp = client.head(url)
    total_size = int(resp.headers.get("content-length", 0))
    resolved_url = str(resp.url)

print(f"Total size: {total_size / (1024*1024):.2f} MB", flush=True)

NUM_THREADS = 16
chunk_size = total_size // NUM_THREADS
ranges = []
for i in range(NUM_THREADS):
    start = i * chunk_size
    end = (start + chunk_size - 1) if i < NUM_THREADS - 1 else total_size - 1
    ranges.append((i, start, end))

progress = [0] * NUM_THREADS
start_time = time.time()

with open(dest, "wb") as f:
    f.seek(total_size - 1)
    f.write(b"\0")

def download_part(idx, start, end):
    cur = start
    while cur <= end:
        headers = {"Range": f"bytes={cur}-{end}"}
        try:
            with httpx.Client(follow_redirects=True, timeout=60.0) as cl:
                with cl.stream("GET", resolved_url, headers=headers) as r:
                    if r.status_code not in (200, 206):
                        time.sleep(1)
                        continue
                    with open(dest, "r+b") as f:
                        f.seek(cur)
                        for chunk in r.iter_bytes(chunk_size=128 * 1024):
                            if chunk:
                                f.write(chunk)
                                cur += len(chunk)
                                progress[idx] = cur - start
        except Exception as e:
            time.sleep(1)

print(f"Downloading tokenizer weights ({total_size/1024/1024:.1f} MB) with {NUM_THREADS} threads...", flush=True)

with ThreadPoolExecutor(max_workers=NUM_THREADS) as executor:
    futures = [executor.submit(download_part, idx, start, end) for idx, start, end in ranges]

    while any(not fut.done() for fut in futures):
        time.sleep(1.0)
        downloaded = sum(progress)
        elapsed = time.time() - start_time
        speed = (downloaded / (elapsed + 0.001)) / (1024 * 1024)
        pct = min(100.0, (downloaded / total_size) * 100)
        print(f"Progress: {pct:.1f}% ({downloaded/(1024*1024):.1f}/{total_size/(1024*1024):.1f} MB) - Speed: {speed:.2f} MB/s", flush=True)

for fut in futures:
    fut.result()

# Copy to LOCAL_DIR_2
import shutil
shutil.copy2(dest, os.path.join(LOCAL_DIR_2, filename))

# Create ref file in huggingface hub cache
ref_path = os.path.expanduser(r"~\.cache\huggingface\hub\models--eustlb--higgs-audio-v2-tokenizer\refs\main")
os.makedirs(os.path.dirname(ref_path), exist_ok=True)
with open(ref_path, "w") as f:
    f.write("528e871c2a26c4f0f7773b9754e2e1acae20899d")

print(f"[OK] Tokenizer download completed in {time.time() - start_time:.1f}s!", flush=True)
