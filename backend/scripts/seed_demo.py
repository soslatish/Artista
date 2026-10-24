#!/usr/bin/env python3
"""Наполняет локальный API демо-данными: художники, покупатель, работы с процедурными «картинами».

Только для разработки. Запуск:  python3 scripts/seed_demo.py [http://localhost:8080]
Требует Pillow.
"""
import io
import json
import math
import random
import sys
import urllib.request
import uuid

from PIL import Image, ImageDraw, ImageFilter

API = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8080").rstrip("/") + "/api/v1"
PASSWORD = "demo12345"


def call(method, path, token=None, body=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            txt = r.read()
            return json.loads(txt)["data"] if txt else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path}: {e.code} {e.read().decode()}")


def user(email, name, role, city, bio=""):
    try:
        r = call("POST", "/auth/register", body={"email": email, "password": PASSWORD, "name": name, "role": role, "city": city})
    except SystemExit:
        r = call("POST", "/auth/login", body={"email": email, "password": PASSWORD})
    tok = r["tokens"]["access_token"]
    if bio:
        call("PATCH", "/me", tok, {"bio": bio})
    return r["user"]["id"], tok


def upload(token, img):
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=88)
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.jpg\"\r\n"
            f"Content-Type: image/jpeg\r\n\r\n").encode() + buf.getvalue() + f"\r\n--{boundary}--\r\n".encode()
    return call("POST", "/uploads", token, raw=body, ctype=f"multipart/form-data; boundary={boundary}")["url"]


# ---------- процедурная живопись ----------

def strokes(d, w, h, palette, n, length, width, rnd, angle=None):
    for _ in range(n):
        x, y = rnd.uniform(0, w), rnd.uniform(0, h)
        a = angle if angle is not None else rnd.uniform(0, math.pi)
        a += rnd.uniform(-0.25, 0.25)
        L = rnd.uniform(length * 0.5, length)
        c = rnd.choice(palette)
        d.line([(x, y), (x + math.cos(a) * L, y + math.sin(a) * L)], fill=c + (rnd.randint(90, 200),), width=int(rnd.uniform(width * 0.5, width)))


def seascape(w, h, rnd, sky, sea, sun):
    im = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(im)
    horizon = int(h * rnd.uniform(0.42, 0.58))
    for y in range(h):
        if y < horizon:
            t = y / horizon
            c = tuple(int(sky[0][i] * (1 - t) + sky[1][i] * t) for i in range(3))
        else:
            t = (y - horizon) / (h - horizon)
            c = tuple(int(sea[0][i] * (1 - t) + sea[1][i] * t) for i in range(3))
        d.line([(0, y), (w, y)], fill=c)
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    sx, sy, r = w * rnd.uniform(0.3, 0.7), horizon - h * 0.12, w * 0.07
    ld.ellipse([sx - r, sy - r, sx + r, sy + r], fill=sun + (230,))
    strokes(ld, w, horizon, [sky[0], sky[1], sun], 220, w * 0.12, 7, rnd, angle=0)
    for i in range(160):
        y = rnd.uniform(horizon, h)
        x = sx + rnd.gauss(0, w * 0.06 * (1 + (y - horizon) / h))
        ld.line([(x - 18, y), (x + 18, y)], fill=sun + (rnd.randint(80, 180),), width=3)
    strokes(ld, w, h, [sea[0], sea[1]], 260, w * 0.1, 6, rnd, angle=0)
    im = Image.alpha_composite(im.convert("RGBA"), layer.filter(ImageFilter.GaussianBlur(1)))
    return im


def color_field(w, h, rnd, bg, blocks):
    im = Image.new("RGBA", (w, h), bg + (255,))
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    m = int(w * 0.08)
    y = m
    for i, c in enumerate(blocks):
        bh = int((h - 2 * m) / len(blocks)) - m // 2
        d.rectangle([m, y, w - m, y + bh], fill=c + (235,))
        y += bh + m // 2
    im = Image.alpha_composite(im, layer.filter(ImageFilter.GaussianBlur(9)))
    d2 = ImageDraw.Draw(im)
    strokes(d2, w, h, blocks, 400, w * 0.05, 3, rnd)
    return im.filter(ImageFilter.GaussianBlur(0.6))


def city(w, h, rnd, sky, walls, accent):
    im = Image.new("RGBA", (w, h), sky + (255,))
    d = ImageDraw.Draw(im)
    x = 0
    while x < w:
        bw = rnd.randint(int(w * 0.08), int(w * 0.2))
        bh = rnd.randint(int(h * 0.3), int(h * 0.75))
        c = rnd.choice(walls)
        d.rectangle([x, h - bh, x + bw, h], fill=c)
        for wy in range(h - bh + 20, h - 20, 34):
            for wx in range(x + 10, x + bw - 14, 26):
                if rnd.random() < 0.55:
                    d.rectangle([wx, wy, wx + 12, wy + 18], fill=accent if rnd.random() < 0.3 else tuple(max(0, v - 40) for v in c))
        x += bw
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    strokes(ImageDraw.Draw(layer), w, h, walls + [sky, accent], 500, w * 0.04, 5, rnd)
    return Image.alpha_composite(im, layer).filter(ImageFilter.GaussianBlur(0.8))


def botanic(w, h, rnd, bg, leaves, flower):
    im = Image.new("RGBA", (w, h), bg + (255,))
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for _ in range(26):
        cx, cy = rnd.uniform(0, w), rnd.uniform(h * 0.2, h)
        for k in range(rnd.randint(3, 7)):
            a = rnd.uniform(-math.pi, 0)
            L = rnd.uniform(h * 0.1, h * 0.28)
            ex, ey = cx + math.cos(a) * L, cy + math.sin(a) * L
            d.line([(cx, cy), (ex, ey)], fill=rnd.choice(leaves) + (200,), width=rnd.randint(6, 16))
    for _ in range(9):
        x, y, r = rnd.uniform(w * 0.1, w * 0.9), rnd.uniform(h * 0.1, h * 0.6), rnd.uniform(w * 0.03, w * 0.07)
        d.ellipse([x - r, y - r, x + r, y + r], fill=flower + (230,))
    return Image.alpha_composite(im, layer.filter(ImageFilter.GaussianBlur(1.2)))


def portrait_abstract(w, h, rnd, bg, skin, dark):
    im = Image.new("RGBA", (w, h), bg + (255,))
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = w / 2, h * 0.42
    d.ellipse([cx - w * 0.22, cy - h * 0.2, cx + w * 0.22, cy + h * 0.2], fill=skin + (240,))
    d.rectangle([cx - w * 0.3, h * 0.66, cx + w * 0.3, h], fill=dark + (240,))
    d.polygon([(cx - w * 0.24, cy - h * 0.08), (cx, cy - h * 0.3), (cx + w * 0.26, cy - h * 0.05), (cx + w * 0.2, cy - h * 0.18)], fill=dark + (230,))
    strokes(d, w, h, [bg, skin, dark], 300, w * 0.06, 6, rnd)
    return Image.alpha_composite(im, layer.filter(ImageFilter.GaussianBlur(1.5)))


ARTISTS = [
    ("marina@demo.artista", "Марина Белова", "Санкт-Петербург", "Пишу Петербург и Финский залив маслом. Выпускница Академии Штиглица."),
    ("timur@demo.artista", "Тимур Ахмедов", "Казань", "Абстракция и цветовое поле. Участник выставок в Казани и Москве."),
    ("olga@demo.artista", "Ольга Звягинцева", "Москва", "Ботаника, гуашь и акварель. Небольшие форматы для дома."),
]


def main():
    rnd = random.Random(42)
    ids = {}
    toks = {}
    for email, name, city_, bio in ARTISTS:
        ids[email], toks[email] = user(email, name, "artist", city_, bio)
    buyer_id, buyer_tok = user("buyer@demo.artista", "Алексей Покупатель", "buyer", "Москва")

    works = [
        ("marina@demo.artista", "Белые ночи на Неве", lambda: seascape(900, 700, rnd, [(244, 214, 196), (196, 170, 196)], [(120, 140, 170), (60, 72, 100)], (252, 226, 170)), "painting", "impressionism", "oil", 80, 60, 42000, "Холст на подрамнике, масло. Июньская ночь, вид со Стрелки Васильевского острова."),
        ("marina@demo.artista", "Залив в октябре", lambda: seascape(700, 900, rnd, [(170, 180, 190), (230, 210, 190)], [(90, 110, 120), (40, 50, 60)], (240, 200, 150)), "painting", "realism", "oil", 50, 65, 28000, "Комарово, холодный осенний вечер. Работа покрыта лаком, готова к развеске."),
        ("marina@demo.artista", "Крыши Коломны", lambda: city(800, 800, rnd, (215, 196, 180), [(150, 90, 80), (180, 160, 130), (110, 100, 110)], (240, 200, 110)), "painting", "expressionism", "acrylic", 60, 60, 35000, "Акрил, мастихин. Крыши старой Коломны на закате."),
        ("timur@demo.artista", "Красное поле", lambda: color_field(700, 950, rnd, (120, 30, 30), [(200, 70, 50), (230, 140, 60), (90, 20, 30)]), "painting", "abstract", "acrylic", 70, 95, 64000, "Большой формат, акрил. Серия «Тишина»."),
        ("timur@demo.artista", "Синий час", lambda: color_field(900, 700, rnd, (25, 35, 70), [(60, 90, 160), (30, 50, 110)]), "painting", "minimalism", "oil", 100, 80, 120000, "Масло на льне. Медитативная работа для просторной стены."),
        ("timur@demo.artista", "Портрет без лица", lambda: portrait_abstract(700, 900, rnd, (210, 190, 150), (230, 180, 150), (40, 40, 60)), "mixed", "contemporary", "mixed_media", 40, 50, 18000, "Смешанная техника на картоне."),
        ("olga@demo.artista", "Пионы в саду", lambda: botanic(700, 900, rnd, (238, 232, 220), [(70, 110, 70), (110, 150, 90), (50, 80, 60)], (220, 120, 140)), "graphics", "naive", "gouache", 30, 40, 9000, "Гуашь на бумаге, оформлена в паспарту."),
        ("olga@demo.artista", "Лесная тропа", lambda: botanic(900, 700, rnd, (200, 210, 190), [(40, 80, 50), (90, 120, 60), (140, 160, 90)], (240, 220, 140)), "graphics", "realism", "watercolor", 40, 30, 7500, "Акварель. Подмосковный лес в мае."),
        ("olga@demo.artista", "Ночной сад", lambda: botanic(800, 800, rnd, (30, 40, 50), [(50, 90, 80), (30, 70, 70)], (230, 200, 120)), "graphics", "contemporary", "gouache", 35, 35, 11000, "Гуашь, тёмный фон, золотистые цветы."),
    ]
    rooms = [["living"], ["bedroom", "living"], ["kitchen", "hallway"], ["living", "office"], ["office", "living"],
             ["bedroom"], ["kids", "bedroom"], ["kitchen"], ["bedroom", "hallway"]]
    # мастерские: заказы на заказ, серия
    call("PATCH", "/me", toks["marina@demo.artista"], {"accepts_commissions": True, "commission_note": "Пишу портреты и виды Петербурга по фото, от 15 000 ₽, срок 2–3 недели."})
    call("PATCH", "/me", toks["olga@demo.artista"], {"accepts_commissions": True, "commission_note": "Ботанические акварели под ваш интерьер, от 6 000 ₽."})
    series = call("POST", "/me/series", toks["marina@demo.artista"], {"title": "Петербург", "description": "Город, залив и белые ночи."})
    created = []
    for i, (email, title, paint, cat, style, tech, wcm, hcm, price, desc) in enumerate(works):
        tok = toks[email]
        imgs = [upload(tok, paint())]
        body = {
            "title": title, "description": desc, "category": cat, "style": style, "technique": tech,
            "materials": "", "width_cm": wcm, "height_cm": hcm, "depth_cm": 2, "year": 2025,
            "price_kop": price * 100, "images": imgs, "publish": True, "rooms": rooms[i], "allow_offers": i % 2 == 1,
        }
        if email == "marina@demo.artista":
            body["series_id"] = series["id"]
        a = call("POST", "/artworks", tok, body)
        created.append(a)
        print("✓", title)

    # активность: подписка, избранное, переписка, заказ
    call("POST", f"/users/{ids['marina@demo.artista']}/follow", buyer_tok)
    call("POST", f"/artworks/{created[3]['id']}/favorite", buyer_tok)
    call("POST", f"/artworks/{created[6]['id']}/favorite", buyer_tok)
    conv = call("POST", "/conversations", buyer_tok, {"user_id": ids["marina@demo.artista"], "artwork_id": created[0]["id"], "message": "Здравствуйте! Работа в раме или только подрамник?"})
    call("POST", f"/conversations/{conv['id']}/messages", toks["marina@demo.artista"], {"body": "Добрый вечер! Только подрамник, но могу подобрать раму в мастерской — около недели."})
    order = call("POST", "/orders", buyer_tok, {"artwork_id": created[1]["id"], "delivery_method": "cdek", "address": {
        "city": "Москва", "street": "ул. Покровка, д. 12, кв. 3", "postal_code": "101000", "recipient_name": "Алексей Покупатель", "phone": "+7 900 000-00-00", "comment": ""}})
    pay = call("POST", f"/orders/{order['id']}/pay", buyer_tok)
    call("POST", f"/payments/{pay['id']}/stub-confirm", buyer_tok)
    call("POST", f"/orders/{order['id']}/confirm", toks["marina@demo.artista"])
    # завершённая покупка — у покупателя появляется сертификат подлинности
    done = call("POST", "/orders", buyer_tok, {"artwork_id": created[7]["id"], "delivery_method": "post", "address": {
        "city": "Москва", "street": "ул. Покровка, д. 12, кв. 3", "postal_code": "101000", "recipient_name": "Алексей Покупатель", "phone": "+7 900 000-00-00", "comment": ""}})
    pay = call("POST", f"/orders/{done['id']}/pay", buyer_tok)
    call("POST", f"/payments/{pay['id']}/stub-confirm", buyer_tok)
    call("POST", f"/orders/{done['id']}/confirm", toks["olga@demo.artista"])
    call("POST", f"/orders/{done['id']}/ship", toks["olga@demo.artista"], {"tracking_number": "80081234567890"})
    call("POST", f"/orders/{done['id']}/complete", buyer_tok)
    call("POST", f"/orders/{done['id']}/review", buyer_tok, {"rating": 5, "text": "Акварель ещё красивее, чем на фото. Упаковано очень бережно."})

    # торг, вопросы, посты
    call("POST", f"/artworks/{created[3]['id']}/offers", buyer_tok, {"amount_kop": 52000_00, "message": "Готов забрать на этой неделе."})
    q = call("POST", f"/artworks/{created[0]['id']}/questions", buyer_tok, {"body": "Можно ли повесить работу у окна, не выцветет?"})
    call("POST", f"/questions/{q['id']}/answer", toks["marina@demo.artista"], {"answer": "Масло покрыто лаком с УФ-фильтром, но прямого солнца лучше избегать."})
    call("POST", "/posts", toks["marina@demo.artista"], {"body": "Вернулась с пленэра в Кронштадте — скоро покажу новые этюды. Пока работаю над большим заливом в мастерской.", "images": [upload(toks["marina@demo.artista"], seascape(900, 700, rnd, [(200, 210, 220), (240, 220, 200)], [(90, 120, 140), (50, 60, 80)], (250, 230, 190)))]})
    call("POST", "/posts", toks["timur@demo.artista"], {"body": "Новая работа из серии «Тишина» уже на аукционе — торги три дня.", "artwork_id": created[4]["id"]})

    # аукцион и выставка-дроп
    call("POST", f"/artworks/{created[4]['id']}/auction", toks["timur@demo.artista"], {"start_kop": 90000_00, "days": 3})
    drafts = []
    for title, paint in [("Ирисы", lambda: botanic(700, 900, rnd, (236, 230, 240), [(70, 100, 80), (90, 130, 90)], (120, 90, 180))),
                         ("Сирень у дома", lambda: botanic(800, 800, rnd, (240, 236, 228), [(60, 100, 70), (100, 140, 90)], (170, 120, 200)))]:
        d = call("POST", "/artworks", toks["olga@demo.artista"], {
            "title": title, "description": "Гуашь на бумаге. Новая весенняя серия.", "category": "graphics", "style": "contemporary",
            "technique": "gouache", "materials": "", "width_cm": 30, "height_cm": 40, "depth_cm": 0, "year": 2026,
            "price_kop": 9500_00, "images": [upload(toks["olga@demo.artista"], paint())], "publish": False, "rooms": ["bedroom"]})
        drafts.append(d["id"])
    import datetime
    starts = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=2)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    ex = call("POST", "/exhibitions", toks["olga@demo.artista"], {"title": "Весенний сад", "description": "Новая серия ботанической гуаши — две работы, которые появятся в продаже одновременно.", "starts_at": starts, "artwork_ids": drafts})
    call("POST", f"/exhibitions/{ex['id']}/remind", buyer_tok)

    # сохранённый поиск: новые работы в синих тонах
    call("POST", "/me/saved-searches", buyer_tok, {"title": "Синие работы до 50 000 ₽", "filters": {"colors": ["blue"], "price_max": 50000_00}})
    print(f"\nГотово. Вход: buyer@demo.artista / {PASSWORD}, художник: marina@demo.artista / {PASSWORD}")


if __name__ == "__main__":
    main()
