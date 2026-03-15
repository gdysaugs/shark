# RunPod worker: Wan 2.2 I2V Rapid Fastmove V2 (FP8 H/L)

This is an additional worker profile. It does not replace the existing `Dockerfile`.

## Required model files

- `models/diffusion_models/wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2FP8H.safetensors`
- `models/diffusion_models/wan22EnhancedNSFWSVICamera_nsfwFASTMOVEV2FP8L.safetensors`
- `models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`
- `models/vae/wan_2.1_vae.safetensors`
- `models/clip_vision/clip-vision_vit-h.safetensors`

## Build

```bash
cd /home/adama/Shark/runpod-worker-wan-rapid
docker build -f Dockerfile.fastmove-v2 -t suarez123/wan22-i2v:fastmove-v2-fp8 .
```

## Push

```bash
docker push suarez123/wan22-i2v:fastmove-v2-fp8
```

## Pages secret

Set:

- `RUNPOD_WAN_RAPID_FASTMOVE_ENDPOINT_URL`

Then use endpoint:

- `/api/wan-rapid-fastmove`
