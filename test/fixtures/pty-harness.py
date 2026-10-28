"""V28B harness: run a command in a real pty, feed it bytes, resize it, and
report how it left the terminal. Prints one JSON object."""
import fcntl, json, os, pty, select, signal, struct, subprocess, sys, termios, time

def main():
    spec = json.loads(sys.argv[1])
    pid, master = pty.fork()
    if pid == 0:
        os.execvpe(spec["argv"][0], spec["argv"], {**os.environ, "TERM": "xterm-256color"})
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
    out = bytearray()
    status = None
    def terminal():
        try:
            lflag = termios.tcgetattr(master)[3]
        except (OSError, termios.error):
            lflag = None
        return {
            "exited": status is not None,
            "code": os.waitstatus_to_exitcode(status) if status is not None else None,
            "echo": bool(lflag & termios.ECHO) if lflag is not None else None,
            "icanon": bool(lflag & termios.ICANON) if lflag is not None else None,
            "output": out.hex(),
        }
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
    # Keys go in once the program says it is reading them. A fixed pause was
    # a race under load: keys typed before raw mode was on were echoed and
    # line-buffered by the tty, and never reached the program as keys.
    ready = bytes.fromhex(spec["ready"]) if "ready" in spec else None
    if ready is None:
        pump(1.5)
    else:
        deadline = time.time() + 20
        while ready not in out and time.time() < deadline:
            pump(0.05)
            done, raw = os.waitpid(pid, os.WNOHANG)
            if done:
                status = raw
                pump(0.2)
                break
        if ready not in out:
            diagnostic = None
            if status is None and "sample" in spec:
                # The direct child is still unreaped, so this PID cannot name
                # an outsider. Sampling is diagnostic, not a scope-death proof.
                try:
                    sampled = subprocess.run(["/usr/bin/sample", str(pid), "1", "1", "-file", spec["sample"]],
                        capture_output=True, text=True, timeout=10)
                    diagnostic = {"exitCode": sampled.returncode, "stdout": sampled.stdout, "stderr": sampled.stderr}
                    if os.path.exists(spec["sample"]):
                        with open(spec["sample"], encoding="utf8", errors="replace") as report:
                            diagnostic["report"] = report.read()
                except (OSError, subprocess.TimeoutExpired) as error:
                    diagnostic = {"error": str(error)}
                pump(0.05)
                done, raw = os.waitpid(pid, os.WNOHANG)
                if done:
                    status = raw
            result = terminal()
            result["ready"] = False
            if diagnostic is not None:
                result["sample"] = diagnostic
            print(json.dumps(result))
            if status is None:
                # forkpty's unreaped session leader pins this fixture group.
                # This cleanup is not arbitrary-descendant containment.
                try:
                    os.killpg(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                os.waitpid(pid, 0)
            return
    # Steps may carry "expect": after the step's fixed wait, keep reading until
    # that marker shows up in output emitted since the last write (bounded by
    # "expect_timeout"). This is the same race as the initial "ready" wait: on a
    # loaded host the program can still be drawing when the pause expires, and
    # the next write lands on the wrong screen and is lost. A missed expect
    # proceeds like a short wait -- the final assertions still see the screen.
    pos = len(out)
    missed = 0
    for step in spec["steps"]:
        if "write" in step:
            os.write(master, bytes.fromhex(step["write"]))
            pos = len(out)
        if "resize" in step:
            rows, cols = step["resize"]
            fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
        if "signal" in step:
            os.kill(pid, getattr(signal, step["signal"]))
        pump(step.get("wait", 0.2))
        if "expect" in step:
            needle = bytes.fromhex(step["expect"])
            deadline = time.time() + step.get("expect_timeout", 20)
            while needle not in out[pos:] and time.time() < deadline:
                pump(0.05)
            if needle not in out[pos:]:
                missed += 1
    # Waited by the clock, not by rounds: once the program has closed its side,
    # a read answers EIO at once and a round takes no time at all.
    deadline = time.time() + 10
    while status is None and time.time() < deadline:
        done, raw = os.waitpid(pid, os.WNOHANG)
        if done:
            status = raw
            break
        pump(0.05)
        time.sleep(0.01)
    pump(0.2)
    result = terminal()
    if ready is not None:
        result["ready"] = True
    result["expectMissed"] = missed
    print(json.dumps(result))
    if status is None:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        os.waitpid(pid, 0)

main()
