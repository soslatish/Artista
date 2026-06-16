import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from typing import List
from ..database import get_db
from ..models import Event, EventApplication, ApplicationStatus, UserRole, EventStatus
from ..schemas import EventCreate, EventOut, EventApplicationCreate, EventApplicationOut
from ..dependencies import get_current_user
from ..models import User
from ..utils.cloudinary_utils import upload_image

router = APIRouter(prefix="/events", tags=["events"])


@router.get("/", response_model=List[EventOut])
def list_events(
    category: str = None,
    city: str = None,
    search: str = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    query = db.query(Event).filter(Event.status == EventStatus.open)
    if category:
        query = query.filter(Event.category == category)
    if city:
        query = query.filter(Event.city.ilike(f"%{city}%"))
    if search:
        query = query.filter(Event.title.ilike(f"%{search}%"))
    return query.order_by(Event.created_at.desc()).offset(skip).limit(limit).all()


@router.post("/", response_model=EventOut, status_code=201)
def create_event(data: EventCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.customer:
        raise HTTPException(status_code=403, detail="Only customers can create events")
    event = Event(**data.model_dump(), user_id=current_user.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get("/my", response_model=List[EventOut])
def my_events(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Event).filter(Event.user_id == current_user.id).order_by(Event.created_at.desc()).all()


@router.get("/{event_id}", response_model=EventOut)
def get_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.post("/{event_id}/images", response_model=EventOut)
async def upload_event_images(
    event_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event or event.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    urls = []
    for f in files:
        content = await f.read()
        urls.append(upload_image(content, folder="artista/events"))
    existing = json.loads(event.images or "[]")
    event.images = json.dumps(existing + urls)
    db.commit()
    db.refresh(event)
    return event


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event or event.user_id != current_user.id:
        raise HTTPException(status_code=404)
    db.delete(event)
    db.commit()


# ─── Event Applications ──────────────────────────────────────────────────────

@router.post("/{event_id}/apply", response_model=EventApplicationOut, status_code=201)
def apply_to_event(
    event_id: int,
    data: EventApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role != UserRole.artist:
        raise HTTPException(status_code=403, detail="Only artists can apply to events")
    event = db.query(Event).filter(Event.id == event_id, Event.status == EventStatus.open).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found or closed")
    existing = db.query(EventApplication).filter(
        EventApplication.event_id == event_id,
        EventApplication.artist_id == current_user.id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already applied")
    app = EventApplication(event_id=event_id, artist_id=current_user.id, **data.model_dump())
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


@router.get("/{event_id}/applications", response_model=List[EventApplicationOut])
def event_applications(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event or event.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    return event.applications


@router.patch("/applications/{app_id}", response_model=EventApplicationOut)
def update_event_application(
    app_id: int,
    status: ApplicationStatus,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    app = db.query(EventApplication).filter(EventApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404)
    if app.event.user_id != current_user.id:
        raise HTTPException(status_code=403)
    app.status = status
    db.commit()
    db.refresh(app)
    return app


@router.get("/applications/my", response_model=List[EventApplicationOut])
def my_event_applications(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(EventApplication)
        .filter(EventApplication.artist_id == current_user.id)
        .order_by(EventApplication.created_at.desc())
        .all()
    )
