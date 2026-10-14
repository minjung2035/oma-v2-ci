import { installClientRuntime } from "./client-runtime.js";
import { pinPackageGeneration } from "./packages/index.js";
// A sandbox mounts its pinned generation under another name. Take its lease
// before any engine or extension import, on that same directory inode.
if (process.env.OMA_PACKAGE_STORE) pinPackageGeneration(process.env.OMA_PACKAGE_STORE);
installClientRuntime();
