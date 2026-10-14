import { renderUnit } from "../../../../dist/src/units/render.js";
const base = { node:"/n", libdir:"/l", state:"/s", society:"demo", agent:"worker" };
// AGENT is an ARGUMENT placeholder -> $ should be doubled to $$
const out = renderUnit("ExecStart=@NODE@ --agent @AGENT@", { ...base, agent: "$FOO" });
console.log("raw bytes:", JSON.stringify(out));
console.log("dollar count:", (out.match(/\$/g)||[]).length);
// SOCIETY is also ARGUMENT
const out2 = renderUnit("ExecStart=x @SOCIETY@", { ...base, society: "a$b" });
console.log("society raw:", JSON.stringify(out2));
