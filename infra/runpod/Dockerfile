# Venviewer trainer image — gsplat 1.5.3 on PyTorch 2.4.1 + CUDA 12.4.
# Targets RunPod A100 80GB (compute capability 8.0). Bake all extension
# dependencies in so a fresh pod boots straight to runnable.
#
# Build:   docker build -t omnitwin/trainer:1.5.3-cu124 .
# Verify:  docker run --rm --gpus all omnitwin/trainer:1.5.3-cu124 python /opt/healthcheck.py
#
# Pinned per D-016 / D-006a — these versions reconcile gsplat 1.5.3, fused-ssim,
# pycolmap rmbrualla fork, and the SPZ encoder all on one CUDA toolchain.

FROM pytorch/pytorch:2.4.1-cuda12.4-cudnn9-devel

ARG DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    TORCH_CUDA_ARCH_LIST="8.0" \
    TORCH_HOME=/opt/torch_home \
    HF_HOME=/opt/hf_home \
    OMNITWIN_TRAINER_VERSION=1.5.3-cu124

# --- system deps ---
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        ca-certificates \
        cmake \
        colmap \
        curl \
        ffmpeg \
        git \
        git-lfs \
        libgl1 \
        libglib2.0-0 \
        libsm6 \
        libxrender1 \
        libxext6 \
        ninja-build \
        openssh-client \
        pkg-config \
        unzip \
        wget \
    && rm -rf /var/lib/apt/lists/*

# rclone direct from rclone.org (Ubuntu's package is multiple major versions stale).
RUN curl -fsSL https://rclone.org/install.sh | bash

# --- python deps (pinned) ---
# numpy and scipy pinned to last 1.x line to avoid NumPy 2 ABI churn against
# pre-built wheels (gsplat, fused-ssim, opencv, pye57).
RUN pip install --upgrade pip==24.2 && pip install \
        numpy==1.26.4 \
        scipy==1.13.1 \
        opencv-python-headless==4.10.0.84 \
        Pillow==10.4.0 \
        tqdm==4.66.5 \
        pyyaml==6.0.2 \
        tyro==0.8.10 \
        tensorboard==2.17.1 \
        einops==0.8.0 \
        plyfile==1.0.3 \
        scikit-image==0.24.0 \
        scikit-learn==1.5.2 \
        imageio==2.35.1 \
        imageio-ffmpeg==0.5.1 \
        open3d==0.18.0 \
        pye57==0.4.16 \
        torchmetrics==1.4.1 \
        lpips==0.1.4 \
        rich==13.8.0

# --- gsplat 1.5.3 (pre-built wheel, NOT pip install from source) ---
# The wheel index is pinned; if it ever moves we explicitly fail rather than
# silently rebuilding from source on the pod.
RUN pip install --extra-index-url https://docs.gsplat.studio/whl/pt24cu124 \
        gsplat==1.5.3+pt24cu124

# --- fused-ssim (matches PyTorch 2.4 / CUDA 12.4) ---
# Optional — venviewer_training.ssim_fallback covers the case if this fails.
RUN pip install fused-ssim==0.0.2 || echo "fused-ssim install failed; trainer falls back to ssim_fallback.py"

# --- pycolmap rmbrualla fork @ cc7ea4b73 ---
# Upstream pycolmap removed the SceneManager class that gsplat's example trainer
# (and our project_e57_depth.py) depend on. NON-NEGOTIABLE: must be the rmbrualla
# fork at this commit. Upstream PyPI pycolmap will silently break the pipeline.
RUN pip install \
        "git+https://github.com/rmbrualla/pycolmap@cc7ea4b73#egg=pycolmap"

# --- SPZ encoder from source ---
# Niantic's reference encoder — used for OPTIONAL post-train compression to .spz.
# Training output stays .ply (gsplat native). SPZ lives at backend ingestion or
# a separate post-train step (T-053).
RUN pip install "git+https://github.com/nianticlabs/spz#egg=spz"

# --- DN-Splatter vendored, NOT installed via nerfstudio ---
# We copy DN-Splatter to /opt/dn-splatter purely as a reference for the
# depth-loss formulation. Full nerfstudio adds ~6GB and pulls a different
# torch pin; we vendor the loss math in venviewer_training.simple_trainer_depth
# and read DN-Splatter as documentation, not as an import.
RUN git clone --depth 1 https://github.com/maturk/dn-splatter.git /opt/dn-splatter \
    && rm -rf /opt/dn-splatter/.git

# --- workspace ---
WORKDIR /workspace
ENV PYTHONPATH=/workspace/code:/opt/dn-splatter:${PYTHONPATH}

# --- bootstrap + healthcheck ---
COPY bootstrap.sh        /opt/bootstrap.sh
COPY verify_build.sh     /opt/verify_build.sh
COPY write_rclone_conf.sh /opt/write_rclone_conf.sh
COPY healthcheck.py      /opt/healthcheck.py
COPY run_training.sh     /opt/run_training.sh
RUN chmod +x /opt/bootstrap.sh /opt/verify_build.sh /opt/write_rclone_conf.sh /opt/run_training.sh

# Force-import gsplat at build time. If the wheel didn't compile the CUDA
# extension cleanly, this fails the build instead of failing the first pod.
RUN python -c "import gsplat; print('gsplat', gsplat.__version__, 'OK')" \
    && python /opt/healthcheck.py --no-cuda

# Pod startup: bootstrap pulls trainer code, sets up SSH/git, drops to bash.
# The operator then runs /opt/run_training.sh manually per the runbook.
CMD ["bash", "-lc", "/opt/bootstrap.sh"]
