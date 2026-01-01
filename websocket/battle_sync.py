"""
Battle Synchronization
Handles real-time battle state between two players
"""

import asyncio
import time
import uuid
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field

# Active battles: battle_id -> Battle
active_battles: Dict[str, 'Battle'] = {}

@dataclass
class Battle:
    id: str
    mode: str
    player1_id: str
    player2_id: str
    player1_deck: List[str]
    player2_deck: List[str]
    player1_trophies: int
    player2_trophies: int
    player1_elo: int
    player2_elo: int

    # Battle state
    status: str = 'waiting'  # waiting, active, finished
    start_time: float = 0
    end_time: float = 0
    duration: int = 180  # 3 minutes default

    # Tower health
    player1_king_hp: int = 4000
    player1_left_hp: int = 2000
    player1_right_hp: int = 2000
    player2_king_hp: int = 4000
    player2_left_hp: int = 2000
    player2_right_hp: int = 2000

    # Crowns
    player1_crowns: int = 0
    player2_crowns: int = 0

    # Elixir
    player1_elixir: float = 5.0
    player2_elixir: float = 5.0
    elixir_rate: float = 1.0  # per second

    # Actions log (for replay/validation)
    actions: List[Dict] = field(default_factory=list)

    # Ready status
    player1_ready: bool = False
    player2_ready: bool = False

    # Result
    winner_id: Optional[str] = None
    result_reported: bool = False


async def create_battle(player1, player2, mode: str) -> Dict:
    """Create a new battle between two players"""
    battle_id = str(uuid.uuid4())

    battle = Battle(
        id=battle_id,
        mode=mode,
        player1_id=player1.player_id,
        player2_id=player2.player_id,
        player1_deck=player1.deck,
        player2_deck=player2.deck,
        player1_trophies=player1.trophies,
        player2_trophies=player2.trophies,
        player1_elo=player1.elo,
        player2_elo=player2.elo,
    )

    # Adjust for chaos mode
    if mode == 'chaos':
        battle.elixir_rate = 1.5
        battle.duration = 180

    active_battles[battle_id] = battle

    print(f"Battle created: {battle_id} ({player1.player_id} vs {player2.player_id})")

    return {
        'id': battle_id,
        'mode': mode,
        'player1': player1.player_id,
        'player2': player2.player_id,
    }


async def player_ready(battle_id: str, player_id: str, ws_manager) -> bool:
    """Mark a player as ready to start"""
    if battle_id not in active_battles:
        return False

    battle = active_battles[battle_id]

    if player_id == battle.player1_id:
        battle.player1_ready = True
    elif player_id == battle.player2_id:
        battle.player2_ready = True
    else:
        return False

    # Both ready? Start the battle
    if battle.player1_ready and battle.player2_ready:
        battle.status = 'active'
        battle.start_time = time.time()

        # Notify both players
        await ws_manager.broadcast_channel(f"battle:{battle_id}", 'battle_start', {
            'battle_id': battle_id,
            'start_time': battle.start_time,
            'duration': battle.duration,
            'elixir_rate': battle.elixir_rate,
        })

        print(f"Battle started: {battle_id}")

    return True


async def handle_battle_action(battle_id: str, player_id: str, action: Dict, ws_manager) -> bool:
    """Handle a battle action from a player"""
    if battle_id not in active_battles:
        return False

    battle = active_battles[battle_id]

    if battle.status != 'active':
        return False

    # Validate player is in this battle
    if player_id not in [battle.player1_id, battle.player2_id]:
        return False

    # Record action with timestamp
    action['player_id'] = player_id
    action['timestamp'] = time.time()
    action['battle_time'] = time.time() - battle.start_time
    battle.actions.append(action)

    # Broadcast action to opponent
    await ws_manager.broadcast_channel(f"battle:{battle_id}", 'battle_action', {
        'action': action,
        'from': 'player1' if player_id == battle.player1_id else 'player2',
    }, exclude=player_id)

    return True


async def handle_tower_damage(battle_id: str, player_id: str, damage_data: Dict, ws_manager) -> bool:
    """Handle tower damage report from a player"""
    if battle_id not in active_battles:
        return False

    battle = active_battles[battle_id]

    if battle.status != 'active':
        return False

    target = damage_data.get('target')  # 'king', 'left', 'right'
    damage = damage_data.get('damage', 0)
    target_player = damage_data.get('target_player')  # 'player1' or 'player2'

    # Apply damage (trust client for now, can add validation later)
    if target_player == 'player1':
        if target == 'king':
            battle.player1_king_hp = max(0, battle.player1_king_hp - damage)
        elif target == 'left':
            battle.player1_left_hp = max(0, battle.player1_left_hp - damage)
        elif target == 'right':
            battle.player1_right_hp = max(0, battle.player1_right_hp - damage)
    else:
        if target == 'king':
            battle.player2_king_hp = max(0, battle.player2_king_hp - damage)
        elif target == 'left':
            battle.player2_left_hp = max(0, battle.player2_left_hp - damage)
        elif target == 'right':
            battle.player2_right_hp = max(0, battle.player2_right_hp - damage)

    # Update crowns
    battle.player1_crowns = _calculate_crowns(
        battle.player2_king_hp, battle.player2_left_hp, battle.player2_right_hp
    )
    battle.player2_crowns = _calculate_crowns(
        battle.player1_king_hp, battle.player1_left_hp, battle.player1_right_hp
    )

    # Check for 3-crown victory
    if battle.player1_crowns >= 3 or battle.player2_crowns >= 3:
        await end_battle(battle_id, ws_manager)

    # Sync state to both players
    await ws_manager.broadcast_channel(f"battle:{battle_id}", 'battle_state', {
        'player1_hp': {
            'king': battle.player1_king_hp,
            'left': battle.player1_left_hp,
            'right': battle.player1_right_hp,
        },
        'player2_hp': {
            'king': battle.player2_king_hp,
            'left': battle.player2_left_hp,
            'right': battle.player2_right_hp,
        },
        'player1_crowns': battle.player1_crowns,
        'player2_crowns': battle.player2_crowns,
    })

    return True


def _calculate_crowns(king_hp: int, left_hp: int, right_hp: int) -> int:
    """Calculate crowns based on tower HP"""
    crowns = 0
    if king_hp <= 0:
        crowns = 3  # King tower = instant 3 crowns
    else:
        if left_hp <= 0:
            crowns += 1
        if right_hp <= 0:
            crowns += 1
    return crowns


async def end_battle(battle_id: str, ws_manager, timeout: bool = False) -> Optional[Dict]:
    """End a battle and determine winner"""
    if battle_id not in active_battles:
        return None

    battle = active_battles[battle_id]

    if battle.status == 'finished':
        return None

    battle.status = 'finished'
    battle.end_time = time.time()

    # Determine winner
    if battle.player1_crowns > battle.player2_crowns:
        battle.winner_id = battle.player1_id
    elif battle.player2_crowns > battle.player1_crowns:
        battle.winner_id = battle.player2_id
    else:
        # Tie - compare king tower HP percentage
        p1_hp_pct = battle.player1_king_hp / 4000
        p2_hp_pct = battle.player2_king_hp / 4000
        if p1_hp_pct > p2_hp_pct:
            battle.winner_id = battle.player1_id
        elif p2_hp_pct > p1_hp_pct:
            battle.winner_id = battle.player2_id
        else:
            battle.winner_id = None  # True tie

    # Calculate rewards and ELO changes
    from services.matchmaking_service import matchmaking

    winner_crowns = max(battle.player1_crowns, battle.player2_crowns)

    if battle.winner_id == battle.player1_id:
        new_p1_elo, new_p2_elo = matchmaking.calculate_elo_change(
            battle.player1_elo, battle.player2_elo, winner_crowns
        )
        p1_trophy_change = 30 + winner_crowns * 5
        p2_trophy_change = -20
    elif battle.winner_id == battle.player2_id:
        new_p2_elo, new_p1_elo = matchmaking.calculate_elo_change(
            battle.player2_elo, battle.player1_elo, winner_crowns
        )
        p1_trophy_change = -20
        p2_trophy_change = 30 + winner_crowns * 5
    else:
        # Tie - small trophy loss for both, no ELO change
        new_p1_elo = battle.player1_elo
        new_p2_elo = battle.player2_elo
        p1_trophy_change = -5
        p2_trophy_change = -5

    result = {
        'battle_id': battle_id,
        'winner_id': battle.winner_id,
        'player1_crowns': battle.player1_crowns,
        'player2_crowns': battle.player2_crowns,
        'timeout': timeout,
        'player1_result': {
            'won': battle.winner_id == battle.player1_id,
            'trophy_change': p1_trophy_change,
            'new_elo': new_p1_elo,
            'crowns': battle.player1_crowns,
            'gold_earned': 50 + battle.player1_crowns * 20 if battle.winner_id == battle.player1_id else 10,
        },
        'player2_result': {
            'won': battle.winner_id == battle.player2_id,
            'trophy_change': p2_trophy_change,
            'new_elo': new_p2_elo,
            'crowns': battle.player2_crowns,
            'gold_earned': 50 + battle.player2_crowns * 20 if battle.winner_id == battle.player2_id else 10,
        }
    }

    # Notify both players
    await ws_manager.send_to_player(battle.player1_id, 'battle_result', {
        **result,
        'your_result': result['player1_result'],
    })
    await ws_manager.send_to_player(battle.player2_id, 'battle_result', {
        **result,
        'your_result': result['player2_result'],
    })

    # Unsubscribe from battle channel
    await ws_manager.unsubscribe(battle.player1_id, f"battle:{battle_id}")
    await ws_manager.unsubscribe(battle.player2_id, f"battle:{battle_id}")

    # Clean up after 30 seconds (in case of reconnects)
    asyncio.create_task(_cleanup_battle(battle_id))

    print(f"Battle ended: {battle_id} - Winner: {battle.winner_id}")

    return result


async def _cleanup_battle(battle_id: str):
    """Clean up battle data after delay"""
    await asyncio.sleep(30)
    if battle_id in active_battles:
        del active_battles[battle_id]


async def battle_timer_loop(ws_manager):
    """Background task to check for battle timeouts"""
    while True:
        try:
            current_time = time.time()

            for battle_id, battle in list(active_battles.items()):
                if battle.status == 'active':
                    elapsed = current_time - battle.start_time
                    remaining = battle.duration - elapsed

                    # Time up
                    if remaining <= 0:
                        await end_battle(battle_id, ws_manager, timeout=True)
                    # 30 second warning
                    elif remaining <= 30 and remaining > 29:
                        await ws_manager.broadcast_channel(f"battle:{battle_id}", 'time_warning', {
                            'remaining': 30
                        })
                    # 10 second warning
                    elif remaining <= 10 and remaining > 9:
                        await ws_manager.broadcast_channel(f"battle:{battle_id}", 'time_warning', {
                            'remaining': 10
                        })

        except Exception as e:
            print(f"Battle timer error: {e}")

        await asyncio.sleep(1)


def get_battle(battle_id: str) -> Optional[Battle]:
    """Get a battle by ID"""
    return active_battles.get(battle_id)


def get_player_battle(player_id: str) -> Optional[Battle]:
    """Get the active battle for a player"""
    for battle in active_battles.values():
        if battle.status in ['waiting', 'active']:
            if player_id in [battle.player1_id, battle.player2_id]:
                return battle
    return None
