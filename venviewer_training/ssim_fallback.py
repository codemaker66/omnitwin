"""Pure-PyTorch SSIM as a fallback when fused-ssim is unavailable.

Drop-in for `from fused_ssim import fused_ssim`. Returns a scalar
SSIM in [0, 1] — used by the trainer as the photometric companion
loss to L1 / MS-SSIM blends. Numerically close to fused-ssim but
~5–10× slower because it doesn't fuse the conv2d kernels.

We pay the slowdown only when fused-ssim's wheel didn't compile
cleanly against the pod's CUDA toolchain. In normal operation,
`from fused_ssim import fused_ssim` succeeds and this module is
never invoked.
"""

from __future__ import annotations

import torch
import torch.nn.functional as F


def _gaussian_window(window_size: int, sigma: float, channels: int) -> torch.Tensor:
    """Separable 2D Gaussian kernel of shape (channels, 1, k, k)."""
    coords = torch.arange(window_size, dtype=torch.float32) - (window_size - 1) / 2.0
    g = torch.exp(-(coords ** 2) / (2.0 * sigma ** 2))
    g = g / g.sum()
    w_2d = g[:, None] @ g[None, :]
    return w_2d.expand(channels, 1, window_size, window_size).contiguous()


def fused_ssim(
    img1: torch.Tensor,
    img2: torch.Tensor,
    window_size: int = 11,
    sigma: float = 1.5,
    data_range: float = 1.0,
) -> torch.Tensor:
    """SSIM between two NCHW (or CHW) float tensors. Returns mean SSIM."""
    if img1.dim() == 3:
        img1 = img1.unsqueeze(0)
        img2 = img2.unsqueeze(0)
    if img1.shape != img2.shape:
        raise ValueError(f"shape mismatch: {tuple(img1.shape)} vs {tuple(img2.shape)}")

    _, c, _, _ = img1.shape
    pad = window_size // 2
    window = _gaussian_window(window_size, sigma, c).to(img1.device, img1.dtype)

    mu1 = F.conv2d(img1, window, padding=pad, groups=c)
    mu2 = F.conv2d(img2, window, padding=pad, groups=c)
    mu1_sq = mu1 * mu1
    mu2_sq = mu2 * mu2
    mu1_mu2 = mu1 * mu2

    sigma1_sq = F.conv2d(img1 * img1, window, padding=pad, groups=c) - mu1_sq
    sigma2_sq = F.conv2d(img2 * img2, window, padding=pad, groups=c) - mu2_sq
    sigma12   = F.conv2d(img1 * img2, window, padding=pad, groups=c) - mu1_mu2

    c1 = (0.01 * data_range) ** 2
    c2 = (0.03 * data_range) ** 2
    ssim_map = (
        ((2 * mu1_mu2 + c1) * (2 * sigma12 + c2))
        / ((mu1_sq + mu2_sq + c1) * (sigma1_sq + sigma2_sq + c2))
    )
    return ssim_map.mean()
