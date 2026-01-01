"""
Matchmaking Service
Handles player queuing and matching using Trophy + ELO system
"""

import asyncio
import time
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field

@dataclass
class QueueEntry:
    player_id: str
    trophies: int
    elo: int
    deck: List[str]
    mode: str
    joined_at: float = field(default_factory=time.time)
    search_range: int = 100  # Initial search range

    def expand_range(self):
        """Expand search range based on wait time"""
        wait_time = time.time() - self.joined_at
        # Expand by 50 every 5 seconds, max 1000
        self.search_range = min(1000, 100 + int(wait_time / 5) * 50)


class MatchmakingService:
    def __init__(self):
        # mode -> list of QueueEntry
        self.queues: Dict[str, List[QueueEntry]] = {}
        # player_id -> mode (to track which queue a player is in)
        self.player_queues: Dict[str, str] = {}
        # ELO K-factor
        self.K_FACTOR = 32
        # Lock for thread-safe queue operations
        self._lock = asyncio.Lock()

    async def join_queue(self, player_id: str, mode: str, trophies: int, elo: int, deck: List[str]) -> bool:
        """Add a player to the matchmaking queue"""
        async with self._lock:
            # Remove from any existing queue
            await self._remove_from_queue(player_id)

            # Create queue entry
            entry = QueueEntry(
                player_id=player_id,
                trophies=trophies,
                elo=elo,
                deck=deck,
                mode=mode
            )

            # Add to queue
            if mode not in self.queues:
                self.queues[mode] = []
            self.queues[mode].append(entry)
            self.player_queues[player_id] = mode

            print(f"Player {player_id} joined {mode} queue (trophies: {trophies}, elo: {elo})")
            return True

    async def leave_queue(self, player_id: str) -> bool:
        """Remove a player from the queue"""
        async with self._lock:
            return await self._remove_from_queue(player_id)

    async def _remove_from_queue(self, player_id: str) -> bool:
        """Internal: Remove player from queue (must hold lock)"""
        if player_id in self.player_queues:
            mode = self.player_queues[player_id]
            if mode in self.queues:
                self.queues[mode] = [e for e in self.queues[mode] if e.player_id != player_id]
            del self.player_queues[player_id]
            return True
        return False

    async def find_match(self, mode: str) -> Optional[Tuple[QueueEntry, QueueEntry]]:
        """Find the best match in a queue"""
        async with self._lock:
            queue = self.queues.get(mode, [])
            if len(queue) < 2:
                return None

            # Expand search ranges for all waiting players
            for entry in queue:
                entry.expand_range()

            # Find best match
            best_match = None
            best_score = float('inf')

            for i, p1 in enumerate(queue):
                for j, p2 in enumerate(queue[i + 1:], i + 1):
                    score = self._match_score(p1, p2)
                    if score is not None and score < best_score:
                        best_score = score
                        best_match = (i, j)

            if best_match:
                i, j = best_match
                # Remove from queue (higher index first)
                player2 = queue.pop(j)
                player1 = queue.pop(i)

                # Remove from tracking
                del self.player_queues[player1.player_id]
                del self.player_queues[player2.player_id]

                print(f"Match found: {player1.player_id} vs {player2.player_id} (score: {best_score:.1f})")
                return (player1, player2)

            return None

    def _match_score(self, p1: QueueEntry, p2: QueueEntry) -> Optional[float]:
        """Calculate match quality score (lower is better)"""
        trophy_diff = abs(p1.trophies - p2.trophies)
        elo_diff = abs(p1.elo - p2.elo)

        # Check if within search range
        max_range = max(p1.search_range, p2.search_range)
        if trophy_diff > max_range:
            return None

        # Weight: 70% ELO, 30% trophies (ELO matters more for fair matches)
        return elo_diff * 0.7 + trophy_diff * 0.3

    def calculate_elo_change(self, winner_elo: int, loser_elo: int, winner_crowns: int) -> Tuple[int, int]:
        """Calculate ELO changes after a match"""
        # Expected win probability
        expected_win = 1 / (1 + 10 ** ((loser_elo - winner_elo) / 400))

        # Crown multiplier (3-crown = 1.5x, 2-crown = 1.2x, 1-crown = 1.0x)
        crown_mult = 1.0 + (winner_crowns - 1) * 0.25

        # Calculate new ELOs
        winner_change = int(self.K_FACTOR * crown_mult * (1 - expected_win))
        loser_change = int(self.K_FACTOR * (0 - (1 - expected_win)))

        new_winner_elo = winner_elo + winner_change
        new_loser_elo = max(0, loser_elo + loser_change)

        return new_winner_elo, new_loser_elo

    def get_queue_position(self, player_id: str) -> Optional[int]:
        """Get a player's position in queue"""
        if player_id not in self.player_queues:
            return None

        mode = self.player_queues[player_id]
        queue = self.queues.get(mode, [])

        for i, entry in enumerate(queue):
            if entry.player_id == player_id:
                return i + 1
        return None

    def get_queue_size(self, mode: str) -> int:
        """Get the number of players in a queue"""
        return len(self.queues.get(mode, []))

    def get_estimated_wait(self, player_id: str) -> Optional[float]:
        """Estimate wait time in seconds"""
        if player_id not in self.player_queues:
            return None

        mode = self.player_queues[player_id]
        queue_size = self.get_queue_size(mode)

        # Rough estimate: 10 seconds per player in queue (assuming matches happen)
        return max(5, queue_size * 10)


# Global matchmaking service instance
matchmaking = MatchmakingService()


async def matchmaking_loop(ws_manager):
    """Background task to continuously find matches"""
    from websocket.battle_sync import create_battle

    while True:
        try:
            # Check all queue modes
            modes = ['normal', 'ranked', 'medals', '2v2', 'draft', 'chaos']
            for mode in modes:
                match = await matchmaking.find_match(mode)
                if match:
                    player1, player2 = match

                    # Create battle
                    battle = await create_battle(player1, player2, mode)

                    # Notify both players
                    await ws_manager.send_to_player(player1.player_id, 'match_found', {
                        'battle_id': battle['id'],
                        'opponent': {
                            'id': player2.player_id,
                            'trophies': player2.trophies,
                            'deck': player2.deck,
                        },
                        'mode': mode,
                        'you_are': 'player1'
                    })

                    await ws_manager.send_to_player(player2.player_id, 'match_found', {
                        'battle_id': battle['id'],
                        'opponent': {
                            'id': player1.player_id,
                            'trophies': player1.trophies,
                            'deck': player1.deck,
                        },
                        'mode': mode,
                        'you_are': 'player2'
                    })

                    # Subscribe both to battle channel
                    await ws_manager.subscribe(player1.player_id, f"battle:{battle['id']}")
                    await ws_manager.subscribe(player2.player_id, f"battle:{battle['id']}")

            # Send queue status updates to waiting players
            for player_id, mode in list(matchmaking.player_queues.items()):
                position = matchmaking.get_queue_position(player_id)
                wait = matchmaking.get_estimated_wait(player_id)
                await ws_manager.send_to_player(player_id, 'queue_status', {
                    'position': position,
                    'queue_size': matchmaking.get_queue_size(mode),
                    'estimated_wait': wait,
                    'mode': mode
                })

        except Exception as e:
            print(f"Matchmaking loop error: {e}")

        # Run every second
        await asyncio.sleep(1)
