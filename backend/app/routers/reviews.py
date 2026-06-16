from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List
from ..database import get_db
from ..models import Review, User
from ..schemas import ReviewCreate, ReviewOut
from ..dependencies import get_current_user

router = APIRouter(prefix="/reviews", tags=["reviews"])


@router.post("/", response_model=ReviewOut, status_code=201)
def create_review(data: ReviewCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if data.reviewed_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot review yourself")
    if not 1 <= data.rating <= 5:
        raise HTTPException(status_code=400, detail="Rating must be 1-5")
    existing = db.query(Review).filter(
        Review.reviewer_id == current_user.id,
        Review.reviewed_id == data.reviewed_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already reviewed this user")
    review = Review(reviewer_id=current_user.id, **data.model_dump())
    db.add(review)
    db.commit()
    # update reviewed user rating
    avg = db.query(func.avg(Review.rating)).filter(Review.reviewed_id == data.reviewed_id).scalar() or 0
    count = db.query(func.count(Review.id)).filter(Review.reviewed_id == data.reviewed_id).scalar()
    reviewed_user = db.query(User).filter(User.id == data.reviewed_id).first()
    if reviewed_user:
        reviewed_user.rating = round(float(avg), 2)
        reviewed_user.reviews_count = count
        db.commit()
    db.refresh(review)
    return review


@router.get("/user/{user_id}", response_model=List[ReviewOut])
def get_user_reviews(user_id: int, skip: int = 0, limit: int = 20, db: Session = Depends(get_db)):
    return (
        db.query(Review)
        .filter(Review.reviewed_id == user_id)
        .order_by(Review.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
