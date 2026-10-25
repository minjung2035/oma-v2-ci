// A controlled Human program under the actual holder. No engine or VM.
import { HostHistoryChannel } from "@oma/engine/host-history-channel";
const channel = HostHistoryChannel.open(5);
if (channel === null) throw new Error('missing private channel');
process.stdin.setRawMode(true); process.stdin.resume();
let selected, switching = false;
const draw = () => process.stdout.write('frame\n');
draw();
process.stdin.on('data', bytes => {
  if (bytes.includes(12)) draw();
  if (bytes.includes(72) && !switching) {
    switching = true;
    void (async () => {
      await channel.pages(page => { selected ??= page.sessions[0]?.reference; });
      if (selected === undefined) throw new Error('no saved host history');
      await channel.inspect(selected);
      await channel.finish(selected);
      process.stdout.write('host-history-selected\n');
    })().catch(error => { process.stderr.write(String(error)); process.exit(7); });
  }
  if (bytes.includes(113)) process.exit(0);
});
process.on('SIGTERM', () => { channel.close(); process.exit(7); });
