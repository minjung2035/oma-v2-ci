// MUST [VIEW-001/002]: START/agents/topics/inbox world views and status assembly.
// Views are derived data; the originals stay in SQLite/Maildir/systemd.
import {
  mkdirSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
  renameSync,
} from "node:fs";
import { join } from "node:path";
import type {
  Actor,
  AgentStatus,
  PreparedBatch,
} from "../implementation/contracts.js";
import { Store } from "./store.js";
import { fsyncDir } from "./mail.js";

export interface UnitObserve {
  (
    agent: Actor,
  ): {
    activeState: string;
    subState: string;
    result: string;
    execMainStatus: number;
  } | null;
}

export function fieldEsce(v: string): string {
  return v.replace(/\t/g, "\\t").replace(/\n/g, "\\n").replace(/\r/g, "");
}

export function writeAtomic(file: string, content: string, mode = 0o600): void {
  mkdirSync(join(file, ".."), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = openSync(tmp, "w", mode);
  try {
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, file);
  fsyncDir(join(file, ".."));
}

export class ViewsModule {
  constructor(
    private readonly store: Store,
    private readonly stateRoot: string,
    private readonly society: string,
    private readonly principalProfile: string,
  ) {}

  /** MUST [VIEW-002]: agents.tsv / topics.tsv, regenerated before start and after mutations. */
  refreshWorld(): void {
    const world = join(this.stateRoot, "world");
    mkdirSync(world, { recursive: true });
    const agents = this.store.listAgents();
    const tsv =
      agents
        .map((a) =>
          [a.name, a.role, a.desired, a.profile].map(fieldEsce).join("\t"),
        )
        .join("\n") + (agents.length > 0 ? "\n" : "");
    writeAtomic(join(world, "agents.tsv"), tsv, 0o444);
    const topics = this.store.allSubscriptions();
    const byTopic = new Map<string, string[]>();
    for (const t of topics) {
      const list = byTopic.get(t.topic) ?? [];
      list.push(t.agent);
      byTopic.set(t.topic, list);
    }
    const topicLines = [...byTopic.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(
        ([topic, subs]) =>
          `${fieldEsce(topic)}\t${fieldEsce([...subs].sort().join(","))}`,
      );
    writeAtomic(
      join(world, "topics.tsv"),
      topicLines.length > 0 ? `${topicLines.join("\n")}\n` : "",
      0o444,
    );
    writeAtomic(join(world, "START.md"), this.startText(), 0o444);
  }

  /** MUST [VIEW-001]: the single startup screen; no schema/DB/systemd internals. */
  private startText(): string {
    const goal = "/world/context/current/GOAL.md";
    const lines = [
      `당신은 ${this.society} society의 Resident입니다.`,
      `목표: ${goal} (없으면 먼저 읽으세요)`,
      `전체 제약: /world/context/current/GOAL.md`,
      "",
      "작업: /workspace",
      "새 연락: /inbox.md",
      "동료: /world/agents.tsv",
      "공개 대화: /mail/archive",
      "",
      "연락: oma send <상대 또는 commons> --file <파일>",
      "결과: oma submit HEAD [--to 상대]",
      "동료 생성/대기: oma agent ...",
      "운영 확인: oma status",
      "",
    ];
    return lines.join("\n");
  }

  /** MUST [BATCH-002]/VIEW: batch notice index as /inbox.md; parent dir is the stable mount. */
  publishInbox(batch: PreparedBatch): void {
    const runView = join(
      this.stateRoot,
      "agents",
      batch.agent,
      "runner",
      "view",
    );
    mkdirSync(runView, { recursive: true });
    const lines: string[] = [
      `# inbox — ${batch.agent}`,
      "",
      `안내 batch ${batch.id} (incarnation ${batch.incarnation})`,
      "",
      ...batch.messageIds.map((id, i) => `${i + 1}. ${id}`),
      "",
      "전체 원문: /mail/archive/cur/<id>:2,",
      "읽기: cat /mail/archive/cur/<id>:2,",
    ];
    writeAtomic(join(runView, "inbox.md"), `${lines.join("\n")}\n`, 0o444);
  }

  /**
   * MUST [VIEW-002]: status assembly from DB + (systemd) observations. Unknown
   * observations are reported as unknown, never as running.
   */
  status(agent?: Actor, observe: UnitObserve = () => null): AgentStatus[] {
    const rows = agent
      ? [this.store.getAgent(agent)].filter(
          (a): a is NonNullable<typeof a> => a !== null,
        )
      : this.store.listAgents();
    const out: AgentStatus[] = [];
    for (const a of rows) {
      const obs = observe(a.name);
      const pending =
        this.store.pendingDeliveries(a.name).length +
        this.store.preparedBatches(a.name).length;
      out.push({
        agent: a.name,
        desired: a.desired,
        activeState: obs?.activeState ?? null,
        subState: obs?.subState ?? null,
        unitResult: obs?.result ?? null,
        execMainStatus: obs?.execMainStatus ?? null,
        pending,
        preparedBatches: this.store.preparedBatches(a.name).length,
        reason: null,
        runnerObservedAtMs: null,
      });
    }
    return out;
  }
}
