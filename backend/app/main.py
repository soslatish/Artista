from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .database import Base, engine
from .routers import auth, users, services, events, messages, reviews

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Artista API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(services.router)
app.include_router(events.router)
app.include_router(messages.router)
app.include_router(reviews.router)


@app.get("/health")
def health():
    return {"status": "ok", "app": "Artista API"}
