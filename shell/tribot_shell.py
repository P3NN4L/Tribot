"""TriBot 原生壳：Python + 系统 WebView2，不再使用 Electron。

布局：
  TriBotShell.exe
  runtime/node.exe
  app/build/server.cjs, app/build/renderer, app/assets ...
"""
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import webview


def base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def find_node(base: Path) -> str:
    bundled = base / "runtime" / "node.exe"
    if bundled.exists():
        return str(bundled)
    import shutil
    node = shutil.which("node")
    if not node:
        raise RuntimeError("找不到 node.exe：请把 Node 运行时放到 runtime/node.exe")
    return node


def free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_health(port: int, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as r:
                if r.status == 200:
                    return True
        except Exception:
            time.sleep(0.25)
    return False


def main() -> None:
    base = base_dir()
    app_dir = Path(os.environ.get("TRIBOT_APP_DIR") or (base / "app"))
    server = app_dir / "build" / "server.cjs"
    if not server.exists():
        raise RuntimeError(f"找不到服务端：{server}")
    node = find_node(base)
    port = free_port()
    data_dir = Path(os.environ.get("TRIBOT_DATA_DIR") or (base / "data"))
    data_dir.mkdir(parents=True, exist_ok=True)

    env = os.environ.copy()
    env.update({
        "TRIBOT_PORT": str(port),
        "TRIBOT_DATA_DIR": str(data_dir),
        "TRIBOT_PACKAGED": "1",
    })
    creation = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    proc = subprocess.Popen(
        [node, str(server)],
        cwd=str(app_dir),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=creation,
    )
    try:
        if not wait_health(port):
            raise RuntimeError("本地服务启动超时：端口 " + str(port))
        url = f"http://127.0.0.1:{port}/?port={port}"
        webview.create_window(
            "TriBot",
            url,
            width=1440,
            height=920,
            min_size=(980, 640),
            background_color="#0c0b0a",
        )
        webview.start()
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


if __name__ == "__main__":
    main()
