import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { InteractiveChannel } from "@oma/engine/interactive-channel";
class Wire extends EventEmitter {
    writableLength = 0;
    blocked = false;
    destroyed = false;
    writes = [];
    write(line) { this.writes.push(line); return !this.blocked; }
    destroy() { this.destroyed = true; this.emit("close"); }
}
function fixture(accept) {
    const wire = new Wire();
    const events = [];
    const endings = [];
    const channel = new InteractiveChannel(wire, { frameBytes: 128, idleStreamSeconds: 0.02, receiptWaitSeconds: 0.02 }, event => { events.push(event); accept?.(event); }, error => endings.push(error));
    return { wire, channel, events, endings };
}
const wait = () => new Promise(resolve => setTimeout(resolve, 60));
test("Open TUI channel: fragmented UTF-8 frames and close during a read have one owner", async () => {
    const f = fixture();
    const bytes = Buffer.from(JSON.stringify({ type: "notice", text: "한글 ✅" }) + "\n");
    const at = bytes.indexOf(Buffer.from("한")) + 1;
    f.wire.emit("data", bytes.subarray(0, at));
    f.wire.emit("data", bytes.subarray(at));
    assert.deepEqual(f.events, [{ type: "notice", text: "한글 ✅" }]);
    await wait();
    assert.equal(f.endings.length, 0, "completed frames must cancel their partial deadline");
    f.channel.close();
    const g = fixture(() => g.channel.close());
    g.wire.emit("data", Buffer.from('{"type":"quit"}\n{"type":"notice"}\n{'));
    await wait();
    assert.equal(g.events.length, 1);
    assert.equal(g.endings.length, 1);
});
test("Open TUI channel: malformed, oversized and unterminated input fail closed once", () => {
    for (const input of ["{bad}\n", '{"type":3}\n', '{"type":"x","id":1}\n', "x".repeat(129), "{\n"]) {
        const f = fixture();
        f.wire.emit("data", Buffer.from(input));
        f.wire.emit("close");
        assert.equal(f.events.length, 0);
        assert.equal(f.endings.length, 1);
        assert.ok(f.endings[0]);
        assert.equal(f.wire.destroyed, true);
    }
    const f = fixture();
    f.wire.emit("data", Buffer.from('{"type":"notice"}'));
    f.wire.emit("end");
    assert.equal(f.endings.length, 1);
    assert.ok(f.endings[0]);
});
test("Open TUI channel: partial-frame and blocked-write deadlines terminate the channel", async () => {
    const partial = fixture();
    partial.wire.emit("data", Buffer.from("{"));
    const blocked = fixture();
    blocked.wire.blocked = true;
    blocked.channel.send({ type: "notice" });
    const drained = fixture();
    drained.wire.blocked = true;
    drained.channel.send({ type: "notice" });
    drained.wire.emit("drain");
    await wait();
    assert.match(String(partial.endings[0]), /frame deadline/);
    assert.match(String(blocked.endings[0]), /write deadline/);
    assert.equal(drained.endings.length, 0);
    drained.channel.close();
});
test("Open TUI channel: outbound size and accumulated backpressure are bounded", () => {
    for (const buffered of [false, true]) {
        const f = fixture();
        if (buffered)
            f.wire.writableLength = 4 * 129;
        f.channel.send({ type: "notice", text: buffered ? "small" : "x".repeat(128) });
        assert.equal(f.wire.writes.length, 0);
        assert.equal(f.endings.length, 1);
        f.channel.send({ type: "notice" });
        assert.equal(f.wire.writes.length, 0, "a closed channel never starts another write");
    }
});
test("DR27/P0-4: a returned UI channel has no live input or timer listeners", () => {
    const f = fixture();
    f.channel.close();
    for (const event of ["data", "end", "close", "drain"])
        assert.equal(f.wire.listenerCount(event), 0, event);
    f.wire.emit("error", new Error("late channel error"));
    assert.equal(f.endings.length, 1);
});
for (const stage of ["data", "end", "drain"]) {
    test(`DR27/P0-4: UI ${stage} setup failure closes without calling an unconstructed owner`, t => {
        const wire = new Wire();
        const original = wire.on;
        const problem = new Error(`injected ${stage} setup failure`);
        let endings = 0;
        t.mock.method(wire, "on", function (event, listener) {
            if (event === stage)
                throw problem;
            return original.call(wire, event, listener);
        });
        assert.throws(() => new InteractiveChannel(wire, { frameBytes: 128, idleStreamSeconds: 1, receiptWaitSeconds: 1 }, () => { }, () => endings++), error => error === problem);
        assert.equal(wire.destroyed, true);
        assert.equal(endings, 0, "a failed constructor never publishes a completed channel");
        for (const event of ["data", "end", "close", "drain"])
            assert.equal(wire.listenerCount(event), 0, event);
        wire.emit("error", new Error("late setup error"));
    });
}
