// MUST [UNIT-001..006]: systemd user unit render/install/lifecycle against the
// operationally running `systemctl --user`. Units are rendered from the
// normative templates; names and ExecStart args come from validated host
// values only (no caller strings).
import { readFileSync, writeFileSync, renameSync, openSync, fsyncSync, closeSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Actor, UnitObservation } from '../implementation/contracts.js';
import { StoreError } from './store.js';

export const UNIT_TPL_DIR = fileURLToPath(new URL('../../implementation/systemd', import.meta.url));

export interface RenderValues {
  node: string;
  libdir: string;
  state: string;
  society: string;
  agent: string;
}

export const INSTALL_DIR = join(
  process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? '/tmp', '.config'),
  'systemd', 'user',
);

/** MUST [UNIT-002]: placeholder substitution; NUL/newline rejected. */
export function renderUnit(template: string, v: RenderValues): string {
  for (const [k, val] of Object.entries(v)) {
    if (val.includes('\0') || val.includes('\n')) {
      throw new StoreError('INVALID_REQUEST', `render value ${k} contains NUL/newline`);
    }
  }
  return template
    .replaceAll('@NODE@', v.node)
    .replaceAll('@LIBDIR@', v.libdir)
    .replaceAll('@STATE@', v.state)
    .replaceAll('@SOCIETY@', v.society)
    .replaceAll('@AGENT@', v.agent);
}

export function unitName(society: string, kind: 'broker' | Actor | 'principal' | 'principal-relay' | 'reconcile', suffix: 'service' | 'path' | 'timer'): string {
  return `oma-${society}-${kind}.${suffix}`;
}

export class UnitsModule {
  constructor(
    private readonly society: string,
    private readonly values: RenderValues,
    private readonly installDir: string = INSTALL_DIR,
  ) {}

  private run(...argv: string[]): string {
    const r = spawnSync('systemctl', ['--user', ...argv], { encoding: 'utf8' });
    return r.stdout?.trim() ?? '';
  }

  /** MUST [UNIT-TPL-002]: atomic install + daemon-reload. */
  private install(name: string, templateName: string): void {
    mkdirSync(this.installDir, { recursive: true });
    const template = readFileSync(join(UNIT_TPL_DIR, templateName), 'utf8');
    const rendered = renderUnit(template, { ...this.values, agent: this.agentFrom(name) });
    const target = join(this.installDir, name);
    const tmp = join(this.installDir, `.${name}.${process.pid}.tmp`);
    const fd = openSync(tmp, 'w', 0o600);
    try {
      writeFileSync(fd, rendered, 'utf8');
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, target);
    try {
      fsyncSync(openSync(this.installDir, 'r'));
    } catch {
      /* directory fsync best-effort */
    }
    // `systemctl --user link` registers the unit with the user manager even when
    // the install dir is not the manager's own search path (tests use isolated
    // XDG dirs; the manager resolves paths from ITS startup environment).
    this.run('link', target);
    this.run('daemon-reload');
  }

  private agentFrom(unit: string): string {
    const base = unit.slice(`oma-${this.society}-`.length);
    const suffix = /\.(service|path|timer)$/.exec(base);
    return suffix ? base.slice(0, -suffix[0].length) : base;
  }

  ensureResident(agent: Actor): void {
    this.install(unitName(this.society, agent, 'service'), 'resident.service.in');
    this.install(unitName(this.society, agent, 'path'), 'resident.path.in');
  }

  ensureBroker(): void {
    this.install(unitName(this.society, 'broker', 'service'), 'broker.service.in');
  }

  ensurePrincipal(): void {
    this.install(unitName(this.society, 'principal', 'path'), 'principal.path.in');
    this.install(unitName(this.society, 'principal-relay', 'service'), 'principal-relay.service.in');
  }

  ensureReconcile(): void {
    this.install(unitName(this.society, 'reconcile', 'service'), 'reconcile.service.in');
    this.install(unitName(this.society, 'reconcile', 'timer'), 'reconcile.timer.in');
  }

  /** MUST [UNIT-005]: enable/start only under host conditions; explicit start resets failure state (UNIT-006). */
  start(agent: Actor, explicitRepair: boolean): void {
    const svc = unitName(this.society, agent, 'service');
    const path = unitName(this.society, agent, 'path');
    if (explicitRepair) this.run('reset-failed', svc);
    this.run('enable', '--now', path);
    this.run('start', svc);
  }

  /** MUST [LIFE-003]: stop path first so mail no longer wakes, then the service. */
  stop(agent: Actor, incarnation: number): UnitObservation {
    const svc = unitName(this.society, agent, 'service');
    const path = unitName(this.society, agent, 'path');
    this.run('stop', path);
    this.run('disable', path);
    const obs = this.observe(agent);
    if (obs.activeState === 'inactive' || obs.activeState === 'dead' || obs.activeState === 'failed') {
      // cgroup already empty (no descendants) — StopUnit is a no-op
      if (!this.cgroupHasProcs(agent)) return obs;
    }
    this.run('stop', svc);
    const after = this.observe(agent);
    void incarnation;
    return after;
  }

  observe(agent: Actor): UnitObservation {
    const svc = unitName(this.society, agent, 'service');
    const out = this.run('show', svc, '-p', 'ActiveState', '-p', 'SubState', '-p', 'Result', '-p', 'ExecMainStatus', '-p', 'ControlGroup');
    const kv = new Map(out.split('\n').map((l) => {
      const i = l.indexOf('=');
      return i < 0 ? [l, ''] as const : [l.slice(0, i), l.slice(i + 1)] as const;
    }));
    const rawStatus = kv.get('ExecMainStatus');
    // systemd reports 0 for never-run/inactive units; the failure detail lives
    // in activeState/subState/result (contracts.ts types this field as number).
    const execMainStatus = rawStatus === undefined || rawStatus === '' || Number.isNaN(Number(rawStatus))
      ? 0
      : Number(rawStatus);
    return {
      activeState: kv.get('ActiveState') ?? 'unknown',
      subState: kv.get('SubState') ?? 'unknown',
      result: kv.get('Result') ?? 'unknown',
      execMainStatus,
      cgroup: kv.get('ControlGroup') ?? '',
      invocationId: '',
    };
  }

  /** Actual cgroup descendants of a unit (S-01: cgroup is the identity source). */
  cgroupProcs(agent: Actor): number[] {
    const obs = this.observe(agent);
    const cg = obs.cgroup;
    if (!cg) return [];
    try {
      const text = readFileSync(join('/sys/fs/cgroup', cg, 'cgroup.procs'), 'utf8');
      return text.split('\n').flatMap((l) => (l ? [Number(l)] : []));
    } catch {
      return []; // unit dead or cgroup removed
    }
  }

  private cgroupHasProcs(agent: Actor): boolean {
    return this.cgroupProcs(agent).length > 0;
  }

  /** MUST [AUTH-003]/[RUN-001]: death confirmed only via an empty cgroup, never by PID polling. */
  confirmDead(agent: Actor, incarnation: number): boolean {
    void incarnation;
    const procs = this.cgroupProcs(agent);
    if (procs.length > 0) return false;
    const obs = this.observe(agent);
    return obs.activeState === 'inactive' || obs.activeState === 'dead' || obs.activeState === 'failed' || obs.cgroup === '';
  }

  /** start-limit surface (UNIT-006): show, never auto reset. */
  startLimitStatus(agent: Actor): string | null {
    const obs = this.observe(agent);
    return obs.activeState === 'failed' && obs.result === 'start-limit-hit' ? 'start_limit' : null;
  }
}