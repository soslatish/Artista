import cloudinary
import cloudinary.uploader
from ..config import settings


def configure_cloudinary():
    cloudinary.config(
        cloud_name=settings.CLOUDINARY_CLOUD_NAME,
        api_key=settings.CLOUDINARY_API_KEY,
        api_secret=settings.CLOUDINARY_API_SECRET,
    )


def upload_image(file_bytes: bytes, folder: str = "artista") -> str:
    configure_cloudinary()
    result = cloudinary.uploader.upload(
        file_bytes,
        folder=folder,
        transformation=[{"width": 1200, "height": 1200, "crop": "limit", "quality": "auto"}],
    )
    return result["secure_url"]


def upload_avatar(file_bytes: bytes) -> str:
    configure_cloudinary()
    result = cloudinary.uploader.upload(
        file_bytes,
        folder="artista/avatars",
        transformation=[{"width": 400, "height": 400, "crop": "fill", "gravity": "face", "quality": "auto"}],
    )
    return result["secure_url"]
