"""
TGStat public page scraper — sidecar for GRASS Phase 7.
POST /tgstat JSON body: { "id": "<username or numeric id>" }
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

app = FastAPI(title="GRASS TGStat worker", version="1.0.0")


class TgStatRequest(BaseModel):
    id: str


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/tgstat")
def tgstat(req: TgStatRequest) -> dict[str, Any]:
    raw = req.id.strip().lstrip("@")
    out: dict[str, Any] = {"found": False, "title": "", "subscribers": 0, "channels": []}
    if not raw:
        return out

    url = f"https://tgstat.ru/channel/@{raw}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            try:
                page = browser.new_page()
                page.goto(url, wait_until="domcontentloaded", timeout=10_000)
                title_el = page.query_selector("h1")
                title = title_el.inner_text().strip() if title_el else ""
                text = page.inner_text("body")
                m = re.search(r"(\d[\d\s,]*)\s*subscribers?", text, re.I)
                subs = 0
                if m:
                    subs = int(re.sub(r"[^\d]", "", m.group(1)) or "0")
                out["title"] = title
                out["subscribers"] = subs
                out["found"] = bool(title) or subs > 0
            finally:
                browser.close()
    except (PlaywrightTimeout, Exception):
        return out
    return out


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
