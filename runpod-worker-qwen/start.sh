#!/usr/bin/env bash
set -euo pipefail

echo "worker-comfyui: Starting ComfyUI"
python -u /comfyui/main.py \
  --disable-auto-launch \
  --disable-metadata \
  --log-stdout \
  --extra-model-paths-config /opt/embedded-models/extra_model_paths.yaml &

echo "worker-comfyui: Starting RunPod handler"
python -u /handler.py
