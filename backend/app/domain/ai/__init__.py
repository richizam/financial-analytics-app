from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .service import AiAssistantService

__all__ = ["AiAssistantService"]


def __getattr__(name: str):
    if name == "AiAssistantService":
        from .service import AiAssistantService

        return AiAssistantService
    raise AttributeError(name)
