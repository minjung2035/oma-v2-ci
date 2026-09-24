"""V28B harness: run a command in a real pty, feed it bytes, resize it, and
report how it left the terminal. Prints one JSON object."""
import fcntl, json, os, pty, select, signal, struct, sys, termios, time

def main():
    spec = json.loads(sys.argv[1])
    pid, master = pty.fork()
    if pid == 0:
        os.execvpe(spec["argv"][0], spec["argv"], {**os.environ, "TERM": "xterm-256color"})
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    out = bytearray()
    def pump(seconds):
        end = time.time() + seconds
        while time.time() < end:
            ready, _, _ = select.select([master], [], [], 0.02)
            if ready:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    return
                if not data:
                    return
                out.extend(data)
    pump(1.5)
    for step in spec["steps"]:
        if "write" in step:
            os.write(master, bytes.fromhex(step["write"]))
        if "resize" in step:
            rows, cols = step["resize"]
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        if "signal" in step:
            os.kill(pid, getattr(signal, step["signal"]))
        pump(step.get("wait", 0.2))
    status = None
    for _ in range(100):
        done, raw = os.waitpid(pid, os.WNOHANG)
        if done:
            status = raw
            break
        pump(0.05)
    pump(0.2)
    attrs = termios.tcgetattr(master)
    lflag = attrs[3]
    print(json.dumps({
        "exited": status is not None,
        "code": os.waitstatus_to_exitcode(status) if status is not None else None,
        "echo": bool(lflag & termios.ECHO),
        "icanon": bool(lflag & termios.ICANON),
        "output": out.hex(),
    }))
    if status is None:
        os.kill(pid, signal.SIGKILL)

main()
