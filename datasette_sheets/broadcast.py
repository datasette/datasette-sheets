"""In-process pub/sub for real-time sheet updates via SSE."""

from __future__ import annotations

import asyncio
import json
import time


class SheetChannel:
    """A broadcast channel for a single sheet. Subscribers each get an asyncio.Queue."""

    def __init__(self, sheet_id: int):
        self.sheet_id = sheet_id
        self._subscribers: dict[str, asyncio.Queue] = {}

    def subscribe(self, client_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=256)
        self._subscribers[client_id] = queue
        return queue

    def unsubscribe(self, client_id: str) -> None:
        self._subscribers.pop(client_id, None)

    def publish(self, event: dict, exclude_client: str | None = None) -> None:
        for client_id, queue in list(self._subscribers.items()):
            if client_id == exclude_client:
                continue
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                # Drop events for slow consumers rather than blocking
                pass

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)


class ChannelManager:
    """Manages SheetChannels, one per sheet_id. Singleton per Datasette instance."""

    def __init__(self):
        self._channels: dict[int, SheetChannel] = {}

    def get_channel(self, sheet_id: int) -> SheetChannel:
        if sheet_id not in self._channels:
            self._channels[sheet_id] = SheetChannel(sheet_id)
        return self._channels[sheet_id]

    def cleanup(self, sheet_id: int) -> None:
        channel = self._channels.get(sheet_id)
        if channel and channel.subscriber_count == 0:
            del self._channels[sheet_id]

    @property
    def active_channels(self) -> int:
        return len(self._channels)


# Singleton — attached to datasette instance at startup
_manager: ChannelManager | None = None


def get_channel_manager() -> ChannelManager:
    global _manager
    if _manager is None:
        _manager = ChannelManager()
    return _manager


def format_sse(event_type: str, data: dict) -> bytes:
    """Format a Server-Sent Event message."""
    payload = json.dumps(data, separators=(",", ":"))
    return f"event: {event_type}\ndata: {payload}\n\n".encode()


SSE_HEARTBEAT = format_sse("heartbeat", {})
