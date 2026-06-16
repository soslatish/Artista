import json
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from typing import List, Optional
from ..database import get_db
from ..models import Service, ServiceApplication, ApplicationStatus, UserRole
from ..schemas import ServiceCreate, ServiceOut, ServiceApplicationCreate, ServiceApplicationOut
from ..dependencies import get_current_user
from ..models import User
from ..utils.cloudinary_utils import upload_image

router = APIRouter(prefix="/services", tags=["services"])


@router.get("/", response_model=List[ServiceOut])
def list_services(
    category: str = None,
    search: str = None,
    skip: int = 0,
    limit: int = 20,
    db: Session = Depends(get_db),
):
    query = db.query(Service).filter(Service.is_active == True)
    if category:
        query = query.filter(Service.category == category)
    if search:
        query = query.filter(Service.title.ilike(f"%{search}%"))
    return query.order_by(Service.created_at.desc()).offset(skip).limit(limit).all()


@router.post("/", response_model=ServiceOut, status_code=201)
def create_service(data: ServiceCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.artist:
        raise HTTPException(status_code=403, detail="Only artists can create services")
    service = Service(**data.model_dump(), user_id=current_user.id)
    db.add(service)
    db.commit()
    db.refresh(service)
    return service


@router.post("/{service_id}/images", response_model=ServiceOut)
async def upload_service_images(
    service_id: int,
    files: List[UploadFile] = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = db.query(Service).filter(Service.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    if service.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    urls = []
    for f in files:
        content = await f.read()
        urls.append(upload_image(content, folder="artista/services"))
    existing = json.loads(service.images or "[]")
    service.images = json.dumps(existing + urls)
    db.commit()
    db.refresh(service)
    return service


@router.get("/my", response_model=List[ServiceOut])
def my_services(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Service).filter(Service.user_id == current_user.id).order_by(Service.created_at.desc()).all()


@router.get("/{service_id}", response_model=ServiceOut)
def get_service(service_id: int, db: Session = Depends(get_db)):
    service = db.query(Service).filter(Service.id == service_id).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    return service


@router.delete("/{service_id}", status_code=204)
def delete_service(service_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    service = db.query(Service).filter(Service.id == service_id).first()
    if not service or service.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Service not found")
    db.delete(service)
    db.commit()


# ─── Applications to services ────────────────────────────────────────────────

@router.post("/{service_id}/apply", response_model=ServiceApplicationOut, status_code=201)
def apply_to_service(
    service_id: int,
    data: ServiceApplicationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = db.query(Service).filter(Service.id == service_id, Service.is_active == True).first()
    if not service:
        raise HTTPException(status_code=404, detail="Service not found")
    existing = db.query(ServiceApplication).filter(
        ServiceApplication.service_id == service_id,
        ServiceApplication.applicant_id == current_user.id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already applied")
    app = ServiceApplication(service_id=service_id, applicant_id=current_user.id, message=data.message)
    db.add(app)
    db.commit()
    db.refresh(app)
    return app


@router.get("/{service_id}/applications", response_model=List[ServiceApplicationOut])
def service_applications(
    service_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    service = db.query(Service).filter(Service.id == service_id).first()
    if not service or service.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    return service.applications


@router.patch("/applications/{app_id}", response_model=ServiceApplicationOut)
def update_application_status(
    app_id: int,
    status: ApplicationStatus,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    app = db.query(ServiceApplication).filter(ServiceApplication.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    if app.service.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")
    app.status = status
    db.commit()
    db.refresh(app)
    return app


@router.get("/applications/my", response_model=List[ServiceApplicationOut])
def my_applications(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return (
        db.query(ServiceApplication)
        .filter(ServiceApplication.applicant_id == current_user.id)
        .order_by(ServiceApplication.created_at.desc())
        .all()
    )
