from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func
from typing import List
from ..database import get_db
from ..models import Message, User
from ..schemas import MessageCreate, MessageOut, ChatPreview, UserOut
from ..dependencies import get_current_user

router = APIRouter(prefix="/messages", tags=["messages"])


@router.get("/chats", response_model=List[ChatPreview])
def get_chats(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    subq = (
        db.query(
            func.max(Message.id).label("last_id"),
        )
        .filter(
            or_(
                Message.sender_id == current_user.id,
                Message.receiver_id == current_user.id,
            )
        )
        .group_by(
            func.case(
                (Message.sender_id == current_user.id, Message.receiver_id),
                else_=Message.sender_id,
            )
        )
        .subquery()
    )

    last_messages = (
        db.query(Message).join(subq, Message.id == subq.c.last_id).order_by(Message.created_at.desc()).all()
    )

    chats = []
    for msg in last_messages:
        other_id = msg.receiver_id if msg.sender_id == current_user.id else msg.sender_id
        other_user = db.query(User).filter(User.id == other_id).first()
        if not other_user:
            continue
        unread = (
            db.query(func.count(Message.id))
            .filter(Message.sender_id == other_id, Message.receiver_id == current_user.id, Message.is_read == False)
            .scalar()
        )
        chats.append(
            ChatPreview(
                user=UserOut.model_validate(other_user),
                last_message=MessageOut.model_validate(msg),
                unread_count=unread,
            )
        )
    return chats


@router.get("/{user_id}", response_model=List[MessageOut])
def get_conversation(
    user_id: int,
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    messages = (
        db.query(Message)
        .filter(
            or_(
                and_(Message.sender_id == current_user.id, Message.receiver_id == user_id),
                and_(Message.sender_id == user_id, Message.receiver_id == current_user.id),
            )
        )
        .order_by(Message.created_at.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    # mark as read
    for msg in messages:
        if msg.receiver_id == current_user.id and not msg.is_read:
            msg.is_read = True
    db.commit()
    return messages


@router.post("/{user_id}", response_model=MessageOut, status_code=201)
def send_message(
    user_id: int,
    data: MessageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="Cannot message yourself")
    receiver = db.query(User).filter(User.id == user_id).first()
    if not receiver:
        raise HTTPException(status_code=404, detail="User not found")
    msg = Message(sender_id=current_user.id, receiver_id=user_id, content=data.content)
    db.add(msg)
    db.commit()
    db.refresh(msg)
    return msg
