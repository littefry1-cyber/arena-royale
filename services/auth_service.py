"""
Authentication Service
Handles password hashing, JWT token generation/validation
"""

import bcrypt
import jwt
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Tuple

# JWT Secret - in production this should be an environment variable
JWT_SECRET = os.environ.get('JWT_SECRET', 'arena-royale-secret-key-change-in-production')
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

def hash_password(password: str) -> str:
    """Hash a password using bcrypt"""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode('utf-8'), salt)
    return hashed.decode('utf-8')

def verify_password(password: str, hashed: str) -> bool:
    """Verify a password against its hash"""
    try:
        return bcrypt.checkpw(password.encode('utf-8'), hashed.encode('utf-8'))
    except Exception:
        return False

def create_token(player_id: str, username: str, is_guest: bool = False) -> str:
    """Create a JWT token for a player"""
    payload = {
        'player_id': player_id,
        'username': username,
        'is_guest': is_guest,
        'iat': datetime.utcnow(),
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token: str) -> Optional[Dict]:
    """Decode and validate a JWT token"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def get_player_id_from_token(token: str) -> Optional[str]:
    """Extract player ID from a valid token"""
    payload = decode_token(token)
    if payload:
        return payload.get('player_id')
    return None

def validate_username(username: str) -> Tuple[bool, str]:
    """Validate username format"""
    if not username:
        return False, "Username is required"
    if len(username) < 3:
        return False, "Username must be at least 3 characters"
    if len(username) > 20:
        return False, "Username must be 20 characters or less"
    if not username.replace('_', '').replace('-', '').isalnum():
        return False, "Username can only contain letters, numbers, underscores, and hyphens"
    return True, ""

def validate_password(password: str) -> Tuple[bool, str]:
    """Validate password format"""
    if not password:
        return False, "Password is required"
    if len(password) < 6:
        return False, "Password must be at least 6 characters"
    if len(password) > 100:
        return False, "Password must be 100 characters or less"
    return True, ""

def generate_guest_username() -> str:
    """Generate a random guest username"""
    import random
    adjectives = ['Swift', 'Brave', 'Mighty', 'Noble', 'Royal', 'Shadow', 'Storm', 'Fire', 'Ice', 'Thunder']
    nouns = ['Knight', 'Archer', 'Wizard', 'Dragon', 'Giant', 'Goblin', 'King', 'Queen', 'Prince', 'Warrior']
    number = random.randint(100, 9999)
    return f"Guest_{random.choice(adjectives)}{random.choice(nouns)}{number}"
