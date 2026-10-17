"""路书封面上传：只收真实位图，统一转成去 EXIF 的 JPEG 与缩略图。

配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 时使用 Supabase Storage 私有桶；
未配置时回退到 ROUTE_MEDIA_ROOT，便于本机开发与隔离测试。
"""
from __future__ import annotations

import io
import os
import uuid
from pathlib import Path
from urllib.parse import quote

import httpx
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


def _supabase_config():
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
    bucket = os.getenv("ROUTE_COVER_BUCKET", "route-covers")
    return (url, key, bucket) if url and key else (None, None, None)


def _storage_url(key: str) -> str:
    url, _key, bucket = _supabase_config()
    return f"{url}/storage/v1/object/{bucket}/{quote(key)}"


def _storage_headers(content_type: str | None = None) -> dict:
    _url, key, _bucket = _supabase_config()
    headers = {"Authorization": "Bearer " + key}
    if content_type:
        headers["Content-Type"] = content_type
    return headers


def _upload(key: str, data: bytes) -> None:
    with httpx.Client(timeout=30, trust_env=False) as client:
        response = client.post(
            _storage_url(key), content=data,
            headers={**_storage_headers("image/jpeg"), "x-upsert": "true"})
    if response.status_code >= 300:
        raise RuntimeError(f"Supabase Storage upload failed: {response.status_code}")


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
    full = _normalize(source, MAX_EDGE)
    thumb = _normalize(source, THUMB_EDGE)
    # 重新编码就丢掉 EXIF（包括 GPS）；不把原图原样搬到公开目录。
    full_bytes = io.BytesIO()
    thumb_bytes = io.BytesIO()
    full.save(full_bytes, "JPEG", quality=86, optimize=True, progressive=True)
    thumb.save(thumb_bytes, "JPEG", quality=80, optimize=True)
    if _supabase_config()[0]:
        try:
            _upload(cover_key, full_bytes.getvalue())
            _upload(thumb_key, thumb_bytes.getvalue())
        except Exception as exc:
            delete(cover_key, thumb_key)
            raise MediaError("STORAGE_FAILED", "封面存储暂时不可用，请稍后重试") from exc
    else:
        base = root()
        base.joinpath(cover_key).write_bytes(full_bytes.getvalue())
        base.joinpath(thumb_key).write_bytes(thumb_bytes.getvalue())
    return {"storage_key": cover_key, "thumbnail_key": thumb_key,
            "width": full.width, "height": full.height}


def delete(*keys: str | None) -> None:
    if _supabase_config()[0]:
        with httpx.Client(timeout=15, trust_env=False) as client:
            for key in keys:
                if not key:
                    continue
                try:
                    client.delete(_storage_url(key), headers=_storage_headers())
                except Exception:
                    pass
        return
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


def read(key: str) -> bytes:
    if _supabase_config()[0]:
        with httpx.Client(timeout=20, trust_env=False) as client:
            response = client.get(_storage_url(key), headers=_storage_headers())
        if response.status_code >= 300:
            raise MediaError("MEDIA_NOT_FOUND", "图片不存在")
        return response.content
    path = root() / Path(key).name
    if key != Path(key).name or not path.is_file():
        raise MediaError("MEDIA_NOT_FOUND", "图片不存在")
    return path.read_bytes()


def public_url(key: str | None) -> str | None:
    return "/media/" + key if key else None
