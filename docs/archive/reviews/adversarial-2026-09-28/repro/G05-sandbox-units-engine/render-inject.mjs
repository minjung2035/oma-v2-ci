import { renderUnit } from "../../../../dist/src/units/render.js";

const base = {
  node: "/opt/oma-node/node",
  libdir: "/opt/oma",
  state: "/home/u/.local/share/oma/demo",
  society: "demo",
  agent: "worker",
};

function tryRender(label, tpl, values) {
  try {
    const out = renderUnit(tpl, values);
    console.log(`[${label}] OK ->`, JSON.stringify(out));
  } catch (e) {
    console.log(`[${label}] THROW ->`, e.code ?? e.name, e.message);
  }
}

// 1) newline injection into an ARGUMENT value (society)
tryRender("newline-society", "Description=@SOCIETY@", { ...base, society: "demo\nExecStart=/bin/evil" });
// 2) newline into STATE (path setting) via state
tryRender("newline-state", "X-OMA-Owner=@STATE@", { ...base, state: "/x\nExecStart=/bin/evil" });
// 3) agent with a space and quotes (ExecStart arg injection)
tryRender("agent-space-quote", "ExecStart=@NODE@ --agent @AGENT@", { ...base, agent: 'a b" ; rm -rf /' });
// 4) agent with a percent (systemd specifier)
tryRender("agent-percent", "ExecStart=@NODE@ --agent @AGENT@", { ...base, agent: "%n%i%%" });
// 5) agent with $ expansion in ExecStart
tryRender("agent-dollar", "ExecStart=@NODE@ --agent @AGENT@", { ...base, agent: "$HOME${x}" });
// 6) STATE with a percent in a path setting
tryRender("state-percent", "DirectoryNotEmpty=@STATE@/mail", { ...base, state: "/a%b/c" });
// 7) STATE trailing whitespace / tab
tryRender("state-tab", "X-OMA-Owner=@STATE@", { ...base, state: "/a\tb" });
// 8) tab in ARGUMENT (agent) - is \t escaped?
tryRender("agent-tab", "ExecStart=@NODE@ --agent @AGENT@", { ...base, agent: "a\tb" });
// 9) agent with backslash
tryRender("agent-backslash", "ExecStart=@NODE@ --agent @AGENT@", { ...base, agent: "a\\x0a" });
// 10) unknown placeholder in template
tryRender("unknown-ph", "ExecStart=@EVIL@", base);
// 11) CR alone in society (JS test uses [\0\r\n])
tryRender("cr-society", "Description=@SOCIETY@", { ...base, society: "demo\rmore" });
