"""SSE endpoint — raw ASGI, registered manually (not via router)."""

import asyncio, uuid
from datasette import Forbidden
from ..broadcast import get_channel_manager, format_sse, SSE_HEARTBEAT
from ..router import PERMISSION_NAME

HEARTBEAT_INTERVAL = 30


async def api_events(datasette, request, send, receive):
    if not await datasette.allowed(action=PERMISSION_NAME, actor=request.actor):
        raise Forbidden("Permission denied")
    sheet_id = int(request.url_vars["sheet_id"])
    client_id = request.args.get("client_id", str(uuid.uuid4()))
    manager = get_channel_manager()
    channel = manager.get_channel(sheet_id)
    queue = channel.subscribe(client_id)
    disconnected = asyncio.Event()

    async def watch_disconnect():
        try:
            while True:
                msg = await receive()
                if msg.get("type") == "http.disconnect":
                    disconnected.set()
                    return
        except Exception:
            disconnected.set()

    task = asyncio.create_task(watch_disconnect())
    try:
        await send(
            {
                "type": "http.response.start",
                "status": 200,
                "headers": [
                    [b"content-type", b"text/event-stream"],
                    [b"cache-control", b"no-cache"],
                    [b"connection", b"keep-alive"],
                    [b"x-accel-buffering", b"no"],
                ],
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": format_sse("connected", {"client_id": client_id}),
                "more_body": True,
            }
        )
        while not disconnected.is_set():
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL)
                etype = event.get("type", "message")
                await send(
                    {
                        "type": "http.response.body",
                        "body": format_sse(
                            etype, {k: v for k, v in event.items() if k != "type"}
                        ),
                        "more_body": True,
                    }
                )
            except asyncio.TimeoutError:
                if disconnected.is_set():
                    break
                await send(
                    {
                        "type": "http.response.body",
                        "body": SSE_HEARTBEAT,
                        "more_body": True,
                    }
                )
    except (asyncio.CancelledError, ConnectionError, OSError):
        pass
    finally:
        task.cancel()
        channel.unsubscribe(client_id)
        manager.cleanup(sheet_id)
        try:
            await send({"type": "http.response.body", "body": b"", "more_body": False})
        except Exception:
            pass
