"""Ask the user before selected consequential agent tool calls in VS Code Local."""

import json
import re
import sys


RISKY_COMMANDS = [
    re.compile(r"\bgit\s+push\b", re.I),
    re.compile(r"\bgit\s+reset\s+--hard\b", re.I),
    re.compile(r"\bgit\s+clean\s+-[^\n]*[fdx]", re.I),
    re.compile(r"\brm\s+-[^\n]*r[^\n]*f\b", re.I),
    re.compile(r"\bsudo\b", re.I),
    re.compile(r"\b(?:gh\s+repo\s+(?:create|delete)|gh\s+secret\s+set)\b", re.I),
    re.compile(r"\bgh\s+(?:pr|issue)\s+(?:create|edit|close|merge|reopen|comment)\b", re.I),
    re.compile(r"\bgh\s+release\s+(?:create|delete|edit|upload)\b", re.I),
    re.compile(r"\bgit\s+branch\s+-D\b", re.I),
    re.compile(r"\b(?:npm|pnpm|yarn)\s+publish\b", re.I),
    re.compile(r"\b(?:vercel|netlify|wrangler)\s+deploy\b", re.I),
    re.compile(r"\b(?:curl|wget)\b[^\n]*\|\s*(?:sh|bash)\b", re.I),
    re.compile(r"\b(?:drop\s+table|truncate\s+table)\b", re.I),
]

SIDE_EFFECT_VERBS = re.compile(
    r"(?:^|[_./:-])(?:create|update|delete|remove|send|post|publish|push|deploy|"
    r"invite|transfer|grant|purchase|pay|share|merge|release)(?:$|[_./:-])",
    re.I,
)
EXTERNAL_TOOL = re.compile(r"(?:mcp|github|gitlab|slack|teams|outlook|email|mail|browser)", re.I)
MUTATING_TOOL = re.compile(r"(?:edit|write|create|delete|remove|patch|replace|terminal|shell|execute|command)", re.I)
PROTECTED_PATHS = (
    ".github/hooks/",
    ".github/agents/security-guardian.agent.md",
    "agents.md",
    "agent-team.md",
)


def walk(value, parent_key=""):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from walk(item, str(key).lower())
    elif isinstance(value, list):
        for item in value:
            yield from walk(item, parent_key)
    elif isinstance(value, str):
        yield parent_key, value


def requires_approval(event):
    tool_name = str(event.get("tool_name", ""))
    tool_input = event.get("tool_input", {})
    strings = list(walk(tool_input))
    serialized_input = json.dumps(tool_input, ensure_ascii=False, sort_keys=True)

    if re.search(r"terminal|shell|execute|command", tool_name, re.I):
        if any(pattern.search(serialized_input) for pattern in RISKY_COMMANDS):
            return "This command can publish, destroy, or materially change user data or systems."

    if EXTERNAL_TOOL.search(tool_name) and SIDE_EFFECT_VERBS.search(tool_name):
        return "This external action can change user data, access, or public content."

    if MUTATING_TOOL.search(tool_name):
        for key, value in strings:
            if key in {"path", "filepath", "file_path", "uri", "filename", "file_name"}:
                normalized = value.replace("\\", "/").lower()
                if any(protected in normalized for protected in PROTECTED_PATHS):
                    return "This action changes the security gate, agent policy, or project instructions."

    return None


def main():
    try:
        event = json.load(sys.stdin)
        reason = requires_approval(event)
        if reason:
            output = {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "ask",
                    "permissionDecisionReason": reason,
                    "additionalContext": (
                        "Stop and run the read-only security-guardian review first. "
                        "Then ask the user to approve this exact action and target. "
                        "The guardian cannot grant user permission."
                    ),
                }
            }
        else:
            output = {"continue": True}
        sys.stdout.write(json.dumps(output))
    except Exception:  # Fail closed so malformed input cannot bypass the gate.
        output = {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "ask",
                "permissionDecisionReason": "The security gate could not classify this tool call.",
                "additionalContext": "Ask the user before proceeding with this tool call.",
            }
        }
        sys.stdout.write(json.dumps(output))


if __name__ == "__main__":
    main()
