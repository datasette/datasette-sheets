"""Tests for the broadcast pub/sub system."""

import asyncio
import pytest
from datasette_sheets.broadcast import SheetChannel, ChannelManager, format_sse


def test_format_sse():
    result = format_sse("cell-update", {"row": 1, "col": 2})
    assert result == b'event: cell-update\ndata: {"row":1,"col":2}\n\n'


def test_channel_subscribe_unsubscribe():
    channel = SheetChannel("sheet1")
    assert channel.subscriber_count == 0

    q = channel.subscribe("client1")
    assert channel.subscriber_count == 1
    assert isinstance(q, asyncio.Queue)

    channel.unsubscribe("client1")
    assert channel.subscriber_count == 0


def test_channel_publish():
    channel = SheetChannel("sheet1")
    q1 = channel.subscribe("client1")
    q2 = channel.subscribe("client2")

    channel.publish({"type": "test", "data": "hello"})

    assert q1.qsize() == 1
    assert q2.qsize() == 1
    assert q1.get_nowait() == {"type": "test", "data": "hello"}
    assert q2.get_nowait() == {"type": "test", "data": "hello"}


def test_channel_publish_exclude_client():
    channel = SheetChannel("sheet1")
    q1 = channel.subscribe("client1")
    q2 = channel.subscribe("client2")

    channel.publish({"type": "test"}, exclude_client="client1")

    assert q1.qsize() == 0  # excluded
    assert q2.qsize() == 1  # received


def test_channel_publish_drops_on_full_queue():
    channel = SheetChannel("sheet1")
    q = channel.subscribe("client1")

    # Fill the queue (maxsize=256)
    for i in range(256):
        channel.publish({"i": i})

    assert q.qsize() == 256

    # This should not raise — it silently drops
    channel.publish({"overflow": True})
    assert q.qsize() == 256


def test_channel_manager():
    manager = ChannelManager()
    assert manager.active_channels == 0

    ch = manager.get_channel("sheet1")
    assert manager.active_channels == 1
    assert manager.get_channel("sheet1") is ch  # same instance

    ch2 = manager.get_channel("sheet2")
    assert manager.active_channels == 2

    manager.cleanup("sheet1")  # no subscribers, should remove
    assert manager.active_channels == 1

    # cleanup with subscribers should keep it
    ch2.subscribe("client1")
    manager.cleanup("sheet2")
    assert manager.active_channels == 1  # still there


def test_channel_manager_cleanup_only_empty():
    manager = ChannelManager()
    ch = manager.get_channel("sheet1")
    ch.subscribe("c1")

    manager.cleanup("sheet1")
    assert manager.active_channels == 1  # still has subscribers

    ch.unsubscribe("c1")
    manager.cleanup("sheet1")
    assert manager.active_channels == 0  # now empty
