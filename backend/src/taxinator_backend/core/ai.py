"""AI-assisted translation and planning using OpenAI."""

from __future__ import annotations

import os
import re
from typing import Any

try:
    from openai import OpenAI
except Exception:  # pragma: no cover - optional dependency guard
    OpenAI = None  # type: ignore

from taxinator_backend.core.models import AITranslateRequest, AITranslateResponse


def _get_api_key() -> str | None:
    return os.getenv("OPENAI_API_KEY") or os.getenv("OPEN-AI-KEY")


def _fallback(reason: str) -> AITranslateResponse:
    return AITranslateResponse(
        status="unavailable",
        vendor_target=None,
        plan="",
        translation="",
        checks=[reason],
        notes=["Provide OPENAI_API_KEY or OPEN-AI-KEY and install openai-agents to enable."],
    )


def _build_prompt(request: AITranslateRequest) -> str:
    base = [
        "You are an expert tax payload translator and validator.",
        "Produce ONLY the translated vendor-ready payload. Do not include a plan, intro, or prose.",
    ]
    if request.vendor_target:
        base.append(f"Target vendor format: {request.vendor_target}.")
    base.append("Source material:")
    base.append(request.input_text.strip())
    if request.attachments:
        base.append(f"Additional context: {request.attachments}")
    return "\n".join(base)


def ai_translate(request: AITranslateRequest) -> AITranslateResponse:
    """Call OpenAI to plan and translate a payload; fall back gracefully if unavailable."""

    api_key = _get_api_key()
    if not api_key or OpenAI is None:
        return _fallback("OpenAI not configured or SDK missing.")

    client = OpenAI(api_key=api_key)
    prompt = _build_prompt(request)

    try:
        # Use the Responses API if available; otherwise treat response as text.
        response = client.responses.create(
            model="gpt-4.1-mini",
            input=[
                {"role": "system", "content": "You are a strict tax-engine translator. Return only the translated payload, no narration."},
                {"role": "user", "content": prompt},
            ],
            max_output_tokens=800,
        )
        text = getattr(response, "output_text", None) or str(response)
    except Exception as exc:  # pragma: no cover - protects app when API fails
        return _fallback(f"AI call failed: {exc}")

    # Extract code fence or JSON-looking block; fall back to raw text.
    translation_block = ""
    fence_match = re.search(r"```(?:json)?\\s*([\\s\\S]*?)```", text, flags=re.IGNORECASE)
    if fence_match:
        translation_block = fence_match.group(1).strip()
    else:
        json_like = re.search(r"(\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\])", text)
        if json_like:
            translation_block = json_like.group(1).strip()
    if not translation_block:
        translation_block = text.strip()

    checks: list[str] = []
    if request.include_checks:
        checks = [
            "Validate required fields and ISO dates.",
            "Confirm numeric fields are decimal strings.",
            "Ensure account/customer IDs align across datasets.",
        ]

    return AITranslateResponse(
        status="ok",
        vendor_target=request.vendor_target,
        plan="",
        translation=translation_block,
        checks=checks,
        notes=["AI-generated; review before sending downstream."],
    )
