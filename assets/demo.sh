#!/bin/bash
# scrollback README demo — records a deterministic session against fixtures/.
# Usage:
#   ln -sfn "$PWD/fixtures" /tmp/fx && mkdir -p /tmp/sb-home
#   asciinema rec --overwrite /tmp/sb-demo.cast -c "bash assets/demo.sh" --window-size 110x36
#   agg --font-size 16 --theme dracula --idle-time-limit 2 /tmp/sb-demo.cast assets/demo.gif

export HOME=/tmp/sb-home
export TERM=xterm-256color
export SCROLLBACK_CLAUDE_ROOT=/tmp/fx/claude/projects
export SCROLLBACK_CODEX_ROOT=/tmp/fx/codex/sessions
export SCROLLBACK_OPENCODE_ROOT=/tmp/fx/opencode/storage
export SCROLLBACK_QWEN_ROOT=/tmp/fx/qwen
export SCROLLBACK_FACTORY_ROOT=/tmp/fx/factory/sessions
export SCROLLBACK_KIMI_ROOT=/tmp/fx/kimi-code/sessions
export SCROLLBACK_CONTINUE_ROOT=/tmp/fx/continue/sessions
export SCROLLBACK_COPILOT_ROOT=/tmp/fx/copilot-cli/session-state
export SCROLLBACK_AIDER_ROOT=/tmp/fx/aider-repo/.aider.chat.history.md
export SCROLLBACK_GOOSE_ROOT=/tmp/fx/goose/sessions
export SCROLLBACK_ANTIGRAVITY_ROOT=/tmp/fx/gemini-root
export SCROLLBACK_VSCODE_ROOT="/tmp/fx/vscode-fake/User|Trae"
export PS1='$ '

cd "$(dirname "$0")/.." || exit 1

type_cmd() {
  printf '$ '
  local cmd="$1"
  for ((i = 0; i < ${#cmd}; i++)); do
    printf '%s' "${cmd:i:1}"
    sleep 0.035
  done
  printf '\n'
  sleep 0.4
}

clear

type_cmd "scrollback doctor"
scrollback doctor
sleep 2.5

type_cmd "scrollback list --global"
scrollback list --global
sleep 2.5

type_cmd 'scrollback search "jwt" --global'
scrollback search "jwt" --global
sleep 2

type_cmd "scrollback context sess-aaa --turns 3"
scrollback context sess-aaa --turns 3
sleep 4
