FROM nvidia/cuda:12.6.3-cudnn-runtime-ubuntu24.04

ARG COMFYUI_VERSION=latest

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_PREFER_BINARY=1 \
    PYTHONUNBUFFERED=1 \
    CMAKE_BUILD_PARALLEL_LEVEL=8

RUN apt-get update && apt-get install -y \
    python3.12 \
    python3.12-venv \
    git \
    wget \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender1 \
    && ln -sf /usr/bin/python3.12 /usr/bin/python \
    && ln -sf /usr/bin/pip3 /usr/bin/pip \
    && apt-get autoremove -y \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

RUN wget -qO- https://astral.sh/uv/install.sh | sh \
    && ln -s /root/.local/bin/uv /usr/local/bin/uv \
    && ln -s /root/.local/bin/uvx /usr/local/bin/uvx \
    && uv venv /opt/venv

ENV PATH="/opt/venv/bin:${PATH}"

RUN uv pip install comfy-cli pip setuptools wheel
RUN /usr/bin/yes | comfy --workspace /comfyui install --version "${COMFYUI_VERSION}" --nvidia
RUN rm -rf /comfyui/custom_nodes/ComfyUI-Manager

RUN mkdir -p \
  /comfyui/models/diffusion_models/anima \
  /comfyui/models/text_encoders/anima \
  /comfyui/models/vae/anima

COPY models/diffusion_models/anima/anima-preview.safetensors /comfyui/models/diffusion_models/anima/
COPY models/text_encoders/anima/qwen_3_06b_base.safetensors /comfyui/models/text_encoders/anima/
COPY models/vae/anima/qwen_image_vae.safetensors /comfyui/models/vae/anima/

WORKDIR /
RUN uv pip install runpod requests websocket-client

COPY handler.py /handler.py
COPY start.sh /start.sh
RUN sed -i 's/\r$//' /handler.py /start.sh \
    && chmod +x /start.sh

CMD ["/start.sh"]
