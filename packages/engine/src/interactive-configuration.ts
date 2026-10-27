import { VERSION } from '@earendil-works/pi-coding-agent';
import { userInfo } from 'node:os';
import { basename, isAbsolute, relative, sep } from 'node:path';
import { UNSEEN } from '@oma/domain/unseen-text';
import type { OpenTuiBrand } from '@oma/contracts/presentation';
const numberEnv = (name: string): number => {
    const value = Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value <= 0)
        throw new Error(`invalid ${name}`);
    return value;
};
/** The project as the Human knows it: under their home, written from `~`. */
function projectDisplay(path: string): string {
    const home = userInfo().homedir;
    const inside = relative(home, path);
    if (inside === "")
        return "~";
    return inside.startsWith("..") || isAbsolute(inside) ? path : `~${sep}${inside}`;
}
export function interactiveConfiguration(input: {
    readonly version: string;
}) {
    const limits = {
        frameBytes: numberEnv("OMA_FRAME_BYTES"), idleStreamSeconds: numberEnv("OMA_UI_IDLE_SECONDS"),
        receiptWaitSeconds: numberEnv("OMA_UI_RECEIPT_SECONDS")
    };
    const argv = process.argv.slice(2);
    const flag = (name: string): string => {
        const index = argv.indexOf(name);
        if (index < 0 || !argv[index + 1])
            throw new Error(`missing ${name}`);
        return argv[index + 1]!;
    };
    const flags = (name: string): string[] => argv.flatMap((value, index) => value === name ? [argv[index + 1]!] : []);
    const agentDir = process.env.PI_CODING_AGENT_DIR;
    if (!agentDir)
        throw new Error("interactive engine needs its private agent directory");
    const cwd = process.cwd();
    /** The Human's project, which the Principal's private workspace (this process's cwd) is not. */
    const projectDir = process.env.OMA_PROJECT_DISPLAY ?? cwd;
    const brand: OpenTuiBrand = {
        title: "oma",
        version: input.version,
        engineVersion: VERSION,
        project: projectDisplay(projectDir.replace(UNSEEN, "")),
        tip: "Ctrl+X oma settings",
        society: (process.env.OMA_SOCIETY ?? "").replace(UNSEEN, ""),
    };
    return {
        limits, argv, flag, flags, agentDir, cwd, projectDir, brand
    };
}
export type InteractiveConfiguration = ReturnType<typeof interactiveConfiguration>;
