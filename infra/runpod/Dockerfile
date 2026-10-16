# Venviewer trainer image — gsplat main @ 512d366b (unreleased 1.6.0) and NVIDIA
# PPISP v1.3.0 on PyTorch 2.14.1 + CUDA 13.2 Update 2 (D-016a, T-655).
# Targets RunPod A100 80GB (sm_80) and H100 (sm_90). Bake all extension
# dependencies in so a fresh pod boots straight to runnable.
#
# NOT YET BUILT OR PUBLISHED (16 Oct 2026): the session that made this change had
# no registry credentials and builds no CUDA images on the shared PC. The pins
# were validated on a RunPod H100 pod on 16 October 2026 through RunPod's own image
# plus apt and pip (RUNBOOK.md, "New environment on a plain RunPod image").
# The previous image, omnitwin/trainer:1.5.3-cu124 (gsplat 1.5.3, PyTorch 2.4.1,
# CUDA 12.4), is this file as it was before D-016a, kept for old recipes.
#
# Build:   docker build -t omnitwin/trainer:gsplat-512d366b-pt2.14.1-cu132 .
# Verify:  docker run --rm --gpus all omnitwin/trainer:gsplat-512d366b-pt2.14.1-cu132 python /opt/healthcheck.py
#
# Pinned per D-016a / D-006a. Every CUDA extension here is compiled by nvcc 13.2.86
# (CUDA 13.2 Update 2): nvcc 12.8 to 13.2 Update 1 can miscompile kernels with nested
# thread divergence (NVIDIA issue 6111901). The build refuses any other nvcc.
# Hosts need a 580-series driver or newer (CUDA 13.x minor-version compatibility;
# validated on 580.126.09); on RunPod create pods with allowedCudaVersions ["13.0"].

# The base declares CUDA_VERSION=13.2.2 but installs the unversioned cuda-toolkit-13-2
# package, so the nvcc check below is what pins the compiler.
FROM pytorch/pytorch:2.14.1-cuda13.2-cudnn9-devel

ARG DEBIAN_FRONTEND=noninteractive
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    TORCH_CUDA_ARCH_LIST="8.0;9.0" \
    BUILD_3DGUT=0 \
    TORCH_HOME=/opt/torch_home \
    HF_HOME=/opt/hf_home \
    CUDA_HOME=/usr/local/cuda \
    OMNITWIN_TRAINER_VERSION=gsplat-512d366b-pt2.14.1-cu132

# --- the extension compiler: nvcc 13.2.86 (CUDA 13.2 Update 2), or the build fails ---
# The base lists NVIDIA's apt repo in /etc/apt/sources.list.d/cuda.list. Do NOT add the
# cuda-keyring package on top: apt then refuses with "Conflicting values set for option
# Signed-By" (the T-655 pod's first boot, 16 Oct 2026). If the base's nvcc is not 13.2.86,
# the pinned toolkit comes from the repo the base already lists.
ARG NVCC_REQUIRED=13.2.86
ARG CUDA_TOOLKIT_PKG=cuda-toolkit-13-2=13.2.2-1
RUN if ! nvcc --version | grep -q "V${NVCC_REQUIRED}"; then \
        apt-get update \
        && apt-get install -y --no-install-recommends --allow-downgrades "${CUDA_TOOLKIT_PKG}" \
        && rm -rf /var/lib/apt/lists/*; \
    fi \
    && nvcc --version \
    && nvcc --version | grep -q "V${NVCC_REQUIRED}" \
    || { echo "REFUSED: nvcc is not ${NVCC_REQUIRED} (D-016a)"; exit 1; }

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
        open3d==0.19.0 \
        pye57==0.4.16 \
        torchmetrics==1.4.1 \
        lpips==0.1.4 \
        rich==13.8.0
# (open3d 0.18.0 has no Python 3.12 wheel; 0.19.0 is the first that does.)

# --- PyTorch / torchvision: the official cu132 wheels (built with CUDA 13.2.2); pin both ---
RUN pip install torch==2.14.1 torchvision==0.29.1 --index-url https://download.pytorch.org/whl/cu132 \
    && python -c "import torch; assert torch.version.cuda.startswith('13.2'), torch.version.cuda; print('torch', torch.__version__)"

# --- gsplat main @ 512d366b, built from source against this PyTorch (D-016a) ---
# gsplat has no release after 1.5.3 (July 2025); main carries the PPISP
# integration, so the commit is the version. BUILD_EXPERIMENTAL=0 skips the
# optional inference renderer; BUILD_3DGUT=0 (ENV above) leaves out the 3DGUT
# kernels, which took about 35 of the full build's 40 minutes and which the trainer
# does not use (D-016a: work that needs 3DGUT builds gsplat without that flag).
# Its largest kernels used about 7 GB of RAM per compiler process, hence the low MAX_JOBS.
ARG GSPLAT_COMMIT=512d366b67073d77ca099ede742683c165dfc23b
RUN git clone https://github.com/nerfstudio-project/gsplat.git /opt/src/gsplat \
    && git -C /opt/src/gsplat checkout "${GSPLAT_COMMIT}" \
    && git -C /opt/src/gsplat submodule update --init --recursive gsplat/cuda/csrc/third_party/glm \
    && cd /opt/src/gsplat && BUILD_EXPERIMENTAL=0 MAX_JOBS=4 pip install --no-build-isolation . \
    && cd / && rm -rf /opt/src/gsplat

# --- NVIDIA PPISP v1.3.0 (gsplat main's post-processing option; T-655 trial) ---
ARG PPISP_COMMIT=a247368047651db2e03e6f97a36e4f5bebbe5c5f
RUN pip install --no-build-isolation "git+https://github.com/nv-tlabs/ppisp.git@${PPISP_COMMIT}"

# --- fused-ssim (rebuilt against PyTorch 2.14 / CUDA 13.2 if it compiles) ---
# Optional — venviewer_training.ssim_fallback covers the case if this fails.
RUN pip install --no-build-isolation fused-ssim==0.0.2 || echo "fused-ssim install failed; trainer falls back to ssim_fallback.py"

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

# Force-import gsplat and PPISP at build time. If either CUDA extension did not
# compile cleanly, this fails the build instead of failing the first pod.
RUN python -c "import gsplat, ppisp; from gsplat import csrc; print('gsplat', gsplat.__version__, 'ppisp', ppisp.__version__, 'OK')" \
    && python /opt/healthcheck.py --no-cuda

# Pod startup: bootstrap pulls trainer code, sets up SSH/git, drops to bash.
# The operator then runs /opt/run_training.sh manually per the runbook.
CMD ["bash", "-lc", "/opt/bootstrap.sh"]
