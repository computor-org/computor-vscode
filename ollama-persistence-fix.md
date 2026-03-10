# Ollama Persistence on macOS

## Problem

`ollama serve &` stops randomly after hours/days on Mac Studio. Known issue across Apple Silicon Macs.

## Relevant GitHub Issues

- [#2225 — Ollama stops generating after a few minutes](https://github.com/ollama/ollama/issues/2225)
- [#6380 — Hangs after 20-30 min, periodic restart required](https://github.com/ollama/ollama/issues/6380)
- [#1458 — Ollama hung after 30 minutes of use](https://github.com/ollama/ollama/issues/1458)
- [#2955 — Guidance to run Ollama as background daemon on macOS](https://github.com/ollama/ollama/issues/2955)
- [#10108 — Gracefully terminate background `ollama serve`](https://github.com/ollama/ollama/issues/10108)
- [#8944 — Ollama crashes on M3 MacBook](https://github.com/ollama/ollama/issues/8944)
- [#11750 — 500 error, llama runner process terminated](https://github.com/ollama/ollama/issues/11750)

## Fix 1: launchd service (recommended)

Create `~/Library/LaunchAgents/com.ollama.serve.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.ollama.serve</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/ollama</string>
        <string>serve</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/ollama.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/ollama.err</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.ollama.serve.plist
```

`KeepAlive: true` auto-restarts Ollama if it crashes.

## Fix 2: Run inside tmux (not with `&`)

```bash
tmux new-session -d -s ollama 'ollama serve'
tmux new-session -d -s agent 'python your_script.py'
```

Don't use `&` — it detaches from the shell, not from tmux.

## Fix 3: Auto-recovery in Python

```python
import subprocess, time, requests

def ensure_ollama():
    try:
        requests.get("http://localhost:11434/api/tags", timeout=2)
    except requests.ConnectionError:
        subprocess.Popen(["ollama", "serve"])
        time.sleep(3)
```

## Debugging

```bash
log show --predicate 'process == "ollama"' --last 24h
log show --predicate 'eventMessage contains "ollama"' --style compact --last 24h | grep -i "kill\|jetsam\|memory"
```
