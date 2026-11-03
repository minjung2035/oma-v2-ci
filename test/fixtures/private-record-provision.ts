/** An owned test child pauses immediately before/after real private provisioning.
 * No SDK, broker, accepted operation or provider is simulated by this probe. */
import { provisionSociety } from "#oma-test/app/runtime/provision";

const [root, phase] = process.argv.slice(2);
if (root === undefined || !["before", "after", "retry"].includes(phase ?? "") || process.send === undefined)
  throw new Error("private provisioning probe needs its fixture root, phase and owner IPC");
process.on("disconnect", () => process.exit(1));
process.on("message", () => {}); // The parent owns the pause until actual child death.
if (phase !== "before") provisionSociety(root, { conversationOnly: true });
process.send({ phase }, error => {
  if (error) process.exit(1);
  if (phase === "retry") process.exit(0);
});
