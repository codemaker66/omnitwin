"""Pure-PyTorch SSIM with the pinned ``fused_ssim`` callable interface.

The focused contract tests cover arguments, shapes, range behavior and a
negative-SSIM case.  They do not establish numerical equivalence with the
fused CUDA package or a performance ratio.  Runtime selection between this
module and ``fused_ssim`` also remains unproved in the pinned RunPod image.
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
    padding: str = "same",
    train: bool = True,
) -> torch.Tensor:
    """Match ``fused_ssim(img1, img2, padding="same", train=True)``."""

    # The CUDA implementation uses ``train`` to choose saved backward state.
    # Native PyTorch autograd records only what is needed automatically, so the
    # value does not alter this fallback's calculation.
    if not isinstance(train, bool):
        raise TypeError("train must be boolean")
    window_size = 11
    sigma = 1.5
    data_range = 1.0
    if img1.dim() == 3:
        img1 = img1.unsqueeze(0)
        img2 = img2.unsqueeze(0)
    if img1.shape != img2.shape:
        raise ValueError(f"shape mismatch: {tuple(img1.shape)} vs {tuple(img2.shape)}")
    if img1.dim() != 4:
        raise ValueError("images must be CHW or NCHW tensors")

    _, c, _, _ = img1.shape
    if padding not in {"same", "valid"}:
        raise ValueError("padding must be 'same' or 'valid'")
    if padding == "valid" and (img1.shape[-2] < window_size or img1.shape[-1] < window_size):
        raise ValueError("valid padding requires images at least 11x11")
    pad = window_size // 2 if padding == "same" else 0
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
