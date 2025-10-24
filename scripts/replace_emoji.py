#!/usr/bin/env python3
"""
Replace emoji and pictographic symbols in text files with ASCII equivalents.

Rules:
- Replace to plain ASCII tokens like [OK], [X], ->, +, etc.
- Remove variation selectors (U+FE0F) used for emoji presentation.
- Only process text files; skip binaries and common vendor/build dirs.
"""
from __future__ import annotations

import os
import sys
import unicodedata as ud

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

EXCLUDE_DIRS = {
    ".git",
    "node_modules",
    "build",
    "dist",
    ".next",
    ".svelte-kit",
    "out",
    "venv",
    ".venv",
    "target",
    "coverage",
    "tmp",
}

# Base mapping for commonly used emoji/pictographs in this repo.
# Keep values plain ASCII or explicit bracketed tokens.
MAP = {
    "[OK]": "[OK]",
    "[X]": "[X]",
    "[WARN]": "[WARN]",
    "[LAUNCH]": "[LAUNCH]",
    "[DONE]": "[DONE]",
    "[LIST]": "[LIST]",
    "[TOOL]": "[TOOL]",
    "[INFO]": "[INFO]",
    "[WEB]": "[WEB]",
    "[GOAL]": "[GOAL]",
    "[BUILD]": "[BUILD]",
    "[PC]": "[PC]",
    "[DESIGN]": "[DESIGN]",
    "[OFFICE]": "[OFFICE]",
    "[$]": "[$]",
    "[TAKE]": "[TAKE]",
    "[TEST]": "[TEST]",
    "[GAME]": "[GAME]",
    "[DOCS]": "[DOCS]",
    "[FIRE]": "[FIRE]",
    "[TOOLS]": "[TOOLS]",
    "*": "*",
    "[MAP]": "[MAP]",
    "[BOOK]": "[BOOK]",
    "[CLEAN]": "[CLEAN]",
    "[FIND]": "[FIND]",
    "[IDEA]": "[IDEA]",
    "[FOLDER]": "[FOLDER]",
    "[WAIT]": "[WAIT]",
    "[ALERT]": "[ALERT]",
    "[BLOCK]": "[BLOCK]",
    "[STATS]": "[STATS]",
    "[PIN]": "[PIN]",
    "[BRAIN]": "[BRAIN]",
    "[ROLES]": "[ROLES]",
    "[BUG]": "[BUG]",
    "[KEY]": "[KEY]",
    "[WAVE]": "[WAVE]",
    "[INBOX]": "[INBOX]",
    "[PKG]": "[PKG]",
    "[STOP]": "[STOP]",
    "[LOCK]": "[LOCK]",
    "[FREE]": "[FREE]",
    "[FAST]": "[FAST]",
    "[123]": "[123]",
    "[$$]": "[$$]",
    "[TAG]": "[TAG]",
    "[ADMIN]": "[ADMIN]",
    "->": "->",
    "[VIEW]": "[VIEW]",
    "<<": "<<",
    "[WIP]": "[WIP]",
    "<->": "<->",
    "[OUT]": "[OUT]",
    "+": "+",
    "[CAM]": "[CAM]",
    "[SHIELD]": "[SHIELD]",
    "[FLAG]": "[FLAG]",
    "[SET]": "[SET]",
    "[FILES]": "[FILES]",
    "[FOLDER]": "[FOLDER]",
    "[DOC]": "[DOC]",
    "TM": "TM",
    "[UP]": "[UP]",
    "[HANDSHAKE]": "[HANDSHAKE]",
    "[ANTENNA]": "[ANTENNA]",
    "[LINK]": "[LINK]",
    "[TEAM]": "[TEAM]",
    "[USER]": "[USER]",
    "[BANK]": "[BANK]",
    "[FUEL]": "[FUEL]",
    "[DOC]": "[DOC]",
    "[WOMAN]": "[WOMAN]",
    "[MAN]": "[MAN]",
    "[PICK]": "[PICK]",
    "[DOWN]": "[DOWN]",
    "[WRITE]": "[WRITE]",
    "[VOTE]": "[VOTE]",
    "[BOOM]": "[BOOM]",
    "[PC]": "[PC]",
    "[MAIL]": "[MAIL]",
    "[GOGGLES]": "[GOGGLES]",
    "[HAMMER]": "[HAMMER]",
    "[BOT]": "[BOT]",
    "[DISK]": "[DISK]",
    "[?]": "[?]",
    "<<": "<<",
    "<": "<",
    ">": ">",
    ">>": ">>",
    "[SCALES]": "[SCALES]",
    "[SWORDS]": "[SWORDS]",
    "[TIME]": "[TIME]",
    "[BOOKMARK]": "[BOOKMARK]",
    "||": "||",
    "[PHONE]": "[PHONE]",
    "[CRYSTAL]": "[CRYSTAL]",
    "[COURT]": "[COURT]",
    "[TROPHY]": "[TROPHY]",
    "[UP]": "[UP]",
    "[PLUG]": "[PLUG]",
    "[CARD]": "[CARD]",
    "[PHONE]": "[PHONE]",
    "[SPARK]": "[SPARK]",
    "[ALARM]": "[ALARM]",
    "[CHAT]": "[CHAT]",
    "[LOCK]": "[LOCK]",
    "[10]": "[10]",
    "*": "*",
    "[PA]": "[PA]",
    "[JOKER]": "[JOKER]",
    "[LIGHTS]": "[LIGHTS]",
    "[PUZZLE]": "[PUZZLE]",
    "[SHUFFLE]": "[SHUFFLE]",
    "[REPEAT]": "[REPEAT]",
    "[DNA]": "[DNA]",
    "[COMPASS]": "[COMPASS]",
    "[PIN]": "[PIN]",
    "[TELESCOPE]": "[TELESCOPE]",
    "o": "o",
    "[TIMER]": "[TIMER]",
    "[WEB]": "[WEB]",
    "[PEN]": "[PEN]",
    "[TRASH]": "[TRASH]",
    "*": "*",
    "->": "->",
    "[ABC]": "[ABC]",
    "<->": "<->",
    "o": "o",
    "o": "o",
    "o": "o",
    "o": "o",
    "o": "o",
    "[COIN]": "[COIN]",
    "[FACTORY]": "[FACTORY]",
    "[NEW]": "[NEW]",
    "[BRICK]": "[BRICK]",
    "[SAT]": "[SAT]",
    "[EARTH]": "[EARTH]",
    "[BRIDGE]": "[BRIDGE]",
    "[FX]": "[FX]",
    "[DICE]": "[DICE]",
    "[CAM]": "[CAM]",
    "[MENU]": "[MENU]",
    "~": "~",
    "[UNLOCK]": "[UNLOCK]",
    "[SKULL]": "[SKULL]",
    "[SUN]": "[SUN]",
    "[MOON]": "[MOON]",
    "[OUTBOX]": "[OUTBOX]",
    "[SHRUG]": "[SHRUG]",
    "<-": "<-",
    "[HOME]": "[HOME]",
    "[ ]": "[ ]",
    "[GREEN]": "[GREEN]",
    "[BANDAGE]": "[BANDAGE]",
    "[BLUE]": "[BLUE]",
    "[ID]": "[ID]",
}

# Remove variation selector-16 wherever found
REMOVE_CHARS = {"\uFE0F"}

TEXT_EXTS = {
    ".md", ".txt", ".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc",
    ".svelte", ".html", ".css", ".scss", ".sass", ".less",
    ".yaml", ".yml", ".toml", ".ini", ".conf",
    ".sh", ".bash", ".zsh", ".fish",
    ".py", ".rb", ".go", ".rs", ".java", ".kt", ".swift",
    ".c", ".h", ".cc", ".cpp", ".m", ".mm",
    ".csv",
}

def looks_text(path: str) -> bool:
    _, ext = os.path.splitext(path)
    if ext.lower() in TEXT_EXTS:
        return True
    # Fallback: skip obvious binaries by extension
    bin_exts = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".woff", ".woff2", ".ttf", ".otf", ".ico", ".mp4", ".mp3"}
    if ext.lower() in bin_exts:
        return False
    # Try sniffing content
    try:
        with open(path, "rb") as f:
            chunk = f.read(2048)
        if b"\x00" in chunk:
            return False
    except Exception:
        return False
    return True

def replace_in_text(text: str) -> str:
    if not text:
        return text
    # First remove variation selectors
    for rc in REMOVE_CHARS:
        text = text.replace(rc, "")
    # Apply explicit mapping
    for k, v in MAP.items():
        if k in text:
            text = text.replace(k, v)
    # As a safety net, replace any remaining pictographs we didn't map with their unicode name token
    # We conservatively handle ranges commonly used for emoji/pictographs
    def fallback(ch: str) -> str:
        try:
            name = ud.name(ch)
        except ValueError:
            return ch
        # Use a short token from the name
        token = name.split()[0]
        # Keep alnum only for token
        token = ''.join(c for c in token if c.isalnum()).upper()
        if not token:
            token = "SYM"
        return f"[{token}]"

    out_chars = []
    for ch in text:
        code = ord(ch)
        if ch in MAP:
            out_chars.append(MAP[ch])
        elif ch in REMOVE_CHARS:
            # removed earlier, but keep consistent
            continue
        elif (
            0x1F000 <= code <= 0x1FAFF  # Misc emoji blocks
            or 0x2600 <= code <= 0x27BF  # Misc symbols + dingbats
            or 0x2300 <= code <= 0x23FF  # Technical symbols
            or 0x2190 <= code <= 0x21FF  # Arrows
            or code in (0x2122, 0x2139) # TM, INFO
        ):
            out_chars.append(fallback(ch))
        else:
            out_chars.append(ch)
    return ''.join(out_chars)

def main() -> int:
    changed = 0
    scanned = 0
    for root, dirs, files in os.walk(ROOT):
        # prune excluded dirs
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for fn in files:
            path = os.path.join(root, fn)
            if not looks_text(path):
                continue
            try:
                with open(path, "r", encoding="utf-8", errors="strict") as f:
                    text = f.read()
            except Exception:
                # Skip files that can't be decoded as UTF-8
                continue
            new_text = replace_in_text(text)
            scanned += 1
            if new_text != text:
                with open(path, "w", encoding="utf-8") as f:
                    f.write(new_text)
                changed += 1
                rel = os.path.relpath(path, ROOT)
                print(f"Rewrote: {rel}")
    print(f"Done. Updated {changed} files (scanned {scanned}).")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())

