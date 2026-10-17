"""路书封面上传：只收真实位图，统一转成去 EXIF 的 JPEG 与缩略图。

生产环境应把 ROUTE_MEDIA_ROOT 指到持久化对象存储挂载点；本机目录只用于开发。
"""
from __future__ import annotations

import io
import os
import uuid
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

MAX_BYTES = 10 * 1024 * 1024
MAX_EDGE = 1920
THUMB_EDGE = 640
ALLOWED = {"JPEG", "PNG", "WEBP"}


class MediaError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def root() -> Path:
    path = Path(os.getenv("ROUTE_MEDIA_ROOT", "/srv/media/covers"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _normalize(image: Image.Image, max_edge: int) -> Image.Image:
    image = ImageOps.exif_transpose(image)
    if image.mode in ("RGBA", "LA") or (image.mode == "P" and "transparency" in image.info):
        bg = Image.new("RGB", image.size, (255, 255, 255))
        rgba = image.convert("RGBA")
        bg.paste(rgba, mask=rgba.getchannel("A"))
        image = bg
    else:
        image = image.convert("RGB")
    image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
    return image


def store(raw: bytes) -> dict:
    if not raw:
        raise MediaError("COVER_EMPTY", "没有收到图片文件")
    if len(raw) > MAX_BYTES:
        raise MediaError("COVER_TOO_LARGE", "封面原图不能超过 10MB")
    try:
        source = Image.open(io.BytesIO(raw))
        source.load()
    except (UnidentifiedImageError, OSError):
        raise MediaError("COVER_TYPE_INVALID", "只接受 JPEG / PNG / WebP 图片")
    if source.format not in ALLOWED:
        raise MediaError("COVER_TYPE_INVALID", "只接受 JPEG / PNG / WebP 图片")
    token = uuid.uuid4().hex
    cover_key = token + ".jpg"
    thumb_key = token + "-thumb.jpg"
    base = root()
    full = _normalize(source, MAX_EDGE)
    thumb = _normalize(source, THUMB_EDGE)
    # 重新编码就丢掉 EXIF（包括 GPS）；不把原图原样搬到公开目录。
    full.save(base / cover_key, "JPEG", quality=86, optimize=True, progressive=True)
    thumb.save(base / thumb_key, "JPEG", quality=80, optimize=True)
    return {"storage_key": cover_key, "thumbnail_key": thumb_key,
            "width": full.width, "height": full.height}


def delete(*keys: str | None) -> None:
    base = root()
    for key in keys:
        if not key:
            continue
        name = Path(key).name
        if name != key:
            continue
        try:
            (base / name).unlink(missing_ok=True)
        except OSError:
            pass


def public_url(key: str | None) -> str | None:
    return "/media/" + key if key else None
