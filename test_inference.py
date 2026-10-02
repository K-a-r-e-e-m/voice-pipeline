import time
import torch

from transformers import AutoProcessor, CohereAsrForConditionalGeneration
from transformers.audio_utils import load_audio


MODEL_ID = "CohereLabs/cohere-transcribe-arabic-07-2026"
AUDIO_FILE = "test.wav"


print("Loading processor...")
processor = AutoProcessor.from_pretrained(MODEL_ID)

print("Loading model...")
model = CohereAsrForConditionalGeneration.from_pretrained(
    MODEL_ID,
    device_map="auto",
)

device = model.device

print("Model device:", device)
print("Model dtype:", model.dtype)


print("Loading audio...")
audio = load_audio(
    AUDIO_FILE,
    sampling_rate=16000,
)

duration = len(audio) / 16000

print("Audio loaded:", round(duration, 3), "seconds")


print("Preparing inputs...")

inputs = processor(
    audio,
    sampling_rate=16000,
    return_tensors="pt",
    language="ar",
)


# Move all tensor inputs to the model device.
for key, value in inputs.items():
    if torch.is_tensor(value):
        if value.is_floating_point():
            inputs[key] = value.to(
                device=device,
                dtype=model.dtype,
            )
        else:
            inputs[key] = value.to(device)


print("Input devices:")

for key, value in inputs.items():
    if torch.is_tensor(value):
        print(f"  {key}: {value.device}")
    else:
        print(f"  {key}: {type(value).__name__}")


print("Running inference...")

torch.cuda.synchronize()
start = time.perf_counter()

outputs = model.generate(
    **inputs,
    max_new_tokens=256,
)

torch.cuda.synchronize()
elapsed = time.perf_counter() - start


text = processor.decode(
    outputs[0],
    skip_special_tokens=True,
)


print()
print("--- RESULT ---")
print(text)

print()
print("--- PERFORMANCE ---")
print("Inference time:", round(elapsed, 3), "seconds")
print("Audio duration:", round(duration, 3), "seconds")
print("RTF:", round(elapsed / duration, 3))