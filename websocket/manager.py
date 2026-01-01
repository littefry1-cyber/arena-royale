"""
WebSocket Connection Manager
Handles WebSocket connections, authentication, and message routing
"""

import json
import asyncio
from typing import Dict, Set, Optional, Callable, Any
from aiohttp import web, WSMsgType
from services.auth_service import decode_token

class WebSocketManager:
    def __init__(self):
        # player_id -> WebSocket connection
        self.connections: Dict[str, web.WebSocketResponse] = {}
        # player_id -> set of subscribed channels (e.g., 'clan:123', 'battle:456')
        self.subscriptions: Dict[str, Set[str]] = {}
        # channel -> set of player_ids
        self.channels: Dict[str, Set[str]] = {}
        # Message handlers: message_type -> handler function
        self.handlers: Dict[str, Callable] = {}

    def register_handler(self, message_type: str, handler: Callable):
        """Register a handler for a message type"""
        self.handlers[message_type] = handler

    async def handle_connection(self, request: web.Request) -> web.WebSocketResponse:
        """Handle a new WebSocket connection"""
        ws = web.WebSocketResponse()
        await ws.prepare(request)

        player_id = None

        try:
            async for msg in ws:
                if msg.type == WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        msg_type = data.get('type')
                        msg_data = data.get('data', {})
                        token = data.get('token')

                        # Handle authentication
                        if msg_type == 'auth':
                            token = msg_data.get('token') or token
                            if token:
                                payload = decode_token(token)
                                if payload:
                                    player_id = payload.get('player_id')
                                    # Check if player is banned
                                    from database import json_db as db
                                    player = await db.get_player(player_id)
                                    if player and player.get('banned', False):
                                        await self.send(ws, 'auth_error', {'error': 'Account banned', 'banned': True})
                                        await ws.close()
                                        continue
                                    self.connections[player_id] = ws
                                    self.subscriptions[player_id] = set()
                                    await self.send(ws, 'auth_ok', {
                                        'player_id': player_id,
                                        'username': payload.get('username')
                                    })
                                    print(f"Player {player_id} connected via WebSocket")
                                    # Broadcast updated online count to all players
                                    await self.broadcast_online_count()
                                else:
                                    await self.send(ws, 'auth_error', {'error': 'Invalid token'})
                            else:
                                await self.send(ws, 'auth_error', {'error': 'Token required'})
                            continue

                        # Require authentication for other messages
                        if not player_id:
                            await self.send(ws, 'error', {'error': 'Not authenticated'})
                            continue

                        # Route to handler
                        if msg_type in self.handlers:
                            try:
                                await self.handlers[msg_type](self, player_id, msg_data)
                            except Exception as e:
                                print(f"Handler error for {msg_type}: {e}")
                                await self.send(ws, 'error', {'error': str(e)})
                        else:
                            await self.send(ws, 'error', {'error': f'Unknown message type: {msg_type}'})

                    except json.JSONDecodeError:
                        await self.send(ws, 'error', {'error': 'Invalid JSON'})

                elif msg.type == WSMsgType.ERROR:
                    print(f'WebSocket error: {ws.exception()}')

        finally:
            # Cleanup on disconnect
            if player_id:
                await self.disconnect(player_id)

        return ws

    async def disconnect(self, player_id: str):
        """Handle player disconnect"""
        # Close the WebSocket connection if it exists
        if player_id in self.connections:
            ws = self.connections[player_id]
            try:
                await ws.close()
            except Exception:
                pass
            del self.connections[player_id]

        # Unsubscribe from all channels
        if player_id in self.subscriptions:
            for channel in self.subscriptions[player_id]:
                if channel in self.channels:
                    self.channels[channel].discard(player_id)
            del self.subscriptions[player_id]

        # Handle battle disconnect (give win to opponent)
        try:
            from websocket.battle_sync import handle_player_disconnect
            await handle_player_disconnect(player_id, self)
        except Exception as e:
            print(f"Error handling battle disconnect: {e}")

        print(f"Player {player_id} disconnected")
        # Broadcast updated online count to all players
        await self.broadcast_online_count()

    async def send(self, ws: web.WebSocketResponse, msg_type: str, data: Any):
        """Send a message to a WebSocket"""
        try:
            if not ws.closed:
                await ws.send_json({
                    'type': msg_type,
                    'data': data,
                    'timestamp': asyncio.get_event_loop().time()
                })
        except Exception as e:
            print(f"Error sending message: {e}")

    async def send_to_player(self, player_id: str, msg_type: str, data: Any):
        """Send a message to a specific player"""
        if player_id in self.connections:
            await self.send(self.connections[player_id], msg_type, data)

    async def subscribe(self, player_id: str, channel: str):
        """Subscribe a player to a channel"""
        if player_id not in self.subscriptions:
            self.subscriptions[player_id] = set()
        self.subscriptions[player_id].add(channel)

        if channel not in self.channels:
            self.channels[channel] = set()
        self.channels[channel].add(player_id)

    async def unsubscribe(self, player_id: str, channel: str):
        """Unsubscribe a player from a channel"""
        if player_id in self.subscriptions:
            self.subscriptions[player_id].discard(channel)
        if channel in self.channels:
            self.channels[channel].discard(player_id)

    async def broadcast_channel(self, channel: str, msg_type: str, data: Any, exclude: str = None):
        """Broadcast a message to all players in a channel"""
        if channel in self.channels:
            for player_id in self.channels[channel]:
                if player_id != exclude:
                    await self.send_to_player(player_id, msg_type, data)

    async def broadcast_all(self, msg_type: str, data: Any, exclude: str = None):
        """Broadcast a message to all connected players"""
        for player_id in self.connections:
            if player_id != exclude:
                await self.send_to_player(player_id, msg_type, data)

    def is_online(self, player_id: str) -> bool:
        """Check if a player is online"""
        return player_id in self.connections

    def get_online_count(self) -> int:
        """Get the number of online players"""
        return len(self.connections)

    def get_online_players(self) -> list:
        """Get list of online player IDs"""
        return list(self.connections.keys())

    async def broadcast_online_count(self):
        """Broadcast online count to all connected players"""
        count = self.get_online_count()
        await self.broadcast_all('online_count', {'count': count})

    async def get_online_players_with_info(self) -> list:
        """Get list of online players with their info"""
        from database import json_db as db
        players = []
        for player_id in self.connections.keys():
            player = await db.get_player(player_id)
            if player:
                players.append({
                    'id': player_id,
                    'name': player.get('profile', {}).get('name', player.get('username', 'Unknown')),
                    'trophies': player.get('stats', {}).get('trophies', 0),
                    'arena': player.get('stats', {}).get('arena', 1)
                })
        return players


# Global WebSocket manager instance
ws_manager = WebSocketManager()
