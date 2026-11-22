import os
import sys
import time
import httpx
from concurrent.futures import ThreadPoolExecutor

REPO = "ehabnegm/lahgtna-omnivoice-egyptian-v3"
LOCAL_DIR = os.path.abspath("./models_cache/lahgtna-omnivoice-egyptian-v3")
os.makedirs(LOCAL_DIR, exist_ok=True)

filename = "model.safetensors"
dest = os.path.join(LOCAL_DIR, filename)
url = f"https://huggingface.co/{REPO}/resolve/main/{filename}"

print(f"Resolving URL for {url} ...", flush=True)

with httpx.Client(follow_redirects=True, timeout=30.0) as client:
    resp = client.head(url)
    total_size = int(resp.headers.get("content-length", 0))
    resolved_url = str(resp.url)

print(f"Total size: {total_size / (1024*1024):.2f} MB", flush=True)

NUM_THREADS = 8
chunk_size = total_size // NUM_THREADS
ranges = []
for i in range(NUM_THREADS):
    start = i * chunk_size
    end = (start + chunk_size - 1) if i < NUM_THREADS - 1 else total_size - 1
    ranges.append((i, start, end))

progress = [0] * NUM_THREADS
start_time = time.time()

# Ensure file exists
if not os.path.exists(dest) or os.path.getsize(dest) != total_size:
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
                        time.sleep(2)
                        continue
                    with open(dest, "r+b") as f:
                        f.seek(cur)
                        for chunk in r.iter_bytes(chunk_size=128 * 1024):
                            if chunk:
                                f.write(chunk)
                                cur += len(chunk)
                                progress[idx] = cur - start
        except Exception as e:
            time.sleep(1.5)

print(f"Downloading with {NUM_THREADS} robust worker threads...", flush=True)

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

print(f"[OK] Download completed successfully in {time.time() - start_time:.1f}s!", flush=True)
