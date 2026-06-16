from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models import User
from ..schemas import UserOut, UserUpdate
from ..dependencies import get_current_user
from ..utils.cloudinary_utils import upload_avatar

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch("/me", response_model=UserOut)
def update_me(data: UserUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    for field, value in data.model_dump(exclude_none=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/me/avatar", response_model=UserOut)
async def upload_my_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    content = await file.read()
    url = upload_avatar(content)
    current_user.avatar_url = url
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: int, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.get("/", response_model=List[UserOut])
def list_artists(
    category: str = None,
    city: str = None,
    search: str = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    from ..models import UserRole
    query = db.query(User).filter(User.role == UserRole.artist, User.is_active == True)
    if category:
        query = query.filter(User.categories.contains(category))
    if city:
        query = query.filter(User.city.ilike(f"%{city}%"))
    if search:
        query = query.filter(User.name.ilike(f"%{search}%"))
    return query.order_by(User.rating.desc()).offset(skip).limit(limit).all()
