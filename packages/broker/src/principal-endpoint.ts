/** PR-001/PR-002: the Principal session's two endpoints, and the only code that
 * decides who the Principal is.
 *
 * A Resident is authorised by its pinned native execution scope. The Principal has
 * none -- the product starts its engine itself, in the Human's terminal -- so
 * these stand in for that scope:
 *
 *  - The host that started this broker is known by the peer at the other end
 *    of the supervision channel it opened at spawn. Nothing else can be that
 *    process, so the host needs no secret to be recognised.
 *  - The host names the engine it started and the broker checks that the
 *    engine really is the host's own child. A credential is minted for that
 *    engine and goes back to the host on the same channel; it is never
 *    written to a file or an environment.
 *  - A model-facing connection is the Principal only if it presents that
 *    credential and the session's handle, AND the connecting process descends
 *    from the registered engine. The credential alone is not enough: a process
 *    that learned it but was not started by the engine is still refused.
 *
 * None of that is decided once and remembered. Both halves of the answer --
 * which registration is current, and whether the caller still descends from
 * the engine that registration named -- are re-derived on every request and
 * every preflight, because both can stop being true without the connection
 * doing anything: the host can re-register, and the engine can die.
 *
 * Delivery (PR-002) is the host's, never the model's: the runner methods that
 * prepare and complete a batch are served for the Principal only on the host
 * endpoint, so nothing the model can run is able to mark its own mail
 * delivered.
 *
 * The broker owns the sockets and the connection machinery, which reach here as
 * ports; process facts come through the shared observation owner. This file
 * neither opens an OS channel nor interprets native credentials.
 */
import { randomBytes } from "node:crypto";
import type { Duplex } from "node:stream";
import type { AuthContext, BoundaryEvidence, PreparedBatch, Request } from "@oma/contracts";
import { StoreError, publicFailure } from "@oma/domain/errors";
import { INTERNAL_METHODS, internalEnvelopeProblem } from "@oma/protocol/methods";
import {
  PRINCIPAL_CREDENTIAL_HEX, credentialMatches, isPrincipalSessionHandle, sessionHandleMatches,
} from "@oma/protocol/principal-credential";
import { okAnswer } from "./replies.js";
import type { BoundPeer } from "./ports.js";
import { descendsFrom, parentOf, processEnded, processIdentity, type ProcessIdentity } from "./process-ancestry.js";

/** The supervision channel as the broker sees it. Present only when a host
 * started this broker; its absence means no Principal endpoint is opened. */
export interface PrincipalHostChannel {
  /** The process at the other end of the channel, pinned by its start time as
   * well as its number: a pid alone is reused, and the delivery endpoint is
   * answered on identity, not on a number that may have been handed on. */
  readonly host: ProcessIdentity;
  /** Tells the host both endpoints are listening. */
  readonly ready: () => void;
  /** Gives the host the credential for the session it registered. */
  readonly grant: (credential: string, sessionHandle: string) => void;
  /** Tells the host the engine it named was not accepted. It names the
   * registration it answers, so a late refusal cannot be taken for the answer
   * to a later registration. */
  readonly refuse: (sessionHandle: string) => void;
  /** Delivers each session the host registers. */
  readonly onSession: (listener: (sessionHandle: string, pid: number) => void) => void;
  /** Releases the channel. The broker owns it for its lifetime. */
  readonly close: () => void;
}

/** Ports shared by both endpoints: the broker's connection machinery. */
interface ConnectionPorts {
  readonly isDraining: () => boolean;
  readonly bindPeer: (socket: Duplex) => BoundPeer | null;
  /** The live authority of the `principal` row, re-derived on every read;
   * `live` says whether what the caller was authorised under still stands. */
  readonly principalContext: (peer: BoundPeer, live: () => boolean) => AuthContext | null;
  readonly serveFrames: (
    socket: Duplex,
    peer: BoundPeer,
    handle: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => Promise<object>,
    preflight: (raw: Record<string, unknown>) => void,
  ) => void;
  readonly fail: (socket: Duplex, failure: ReturnType<typeof publicFailure>) => void;
  readonly observe: (error: unknown) => void;
  readonly cleanupError: (error: unknown) => void;
}

export interface PrincipalEndpointPorts extends ConnectionPorts {
  readonly dispatch: (auth: AuthContext, request: Request, stream: AsyncIterable<Uint8Array> | null) => Promise<object>;
  readonly preflight: (auth: AuthContext, raw: Record<string, unknown>) => void;
}

export interface PrincipalHostEndpointPorts extends ConnectionPorts {
  readonly prepare: (auth: AuthContext) => Promise<PreparedBatch | null>;
  readonly complete: (auth: AuthContext, evidence: BoundaryEvidence) => Promise<void>;
  /** The engine this broker currently holds a Principal registration for, or
   * null when it holds none. Read on every request, because a registration is
   * retired by events this endpoint never sees. */
  readonly registeredEngine: () => number | null;
}

interface RegisteredSession {
  readonly sessionHandle: string;
  readonly engine: ProcessIdentity;
  readonly credential: string;
  /** Tells this registration apart from every other one this broker makes,
   * including a re-registration of the same handle by the same engine. A
   * connection is bound to the number, not to the authority it was handed, so
   * "is this still the Principal?" has an answer that does not depend on the
   * connection having noticed anything. */
  readonly generation: number;
}

/** Whether this peer is the host itself. The pid is compared against the
 * identity the channel pinned, so a process that merely inherited the number
 * after the host died is not mistaken for it. */
function isHost(peer: BoundPeer, host: ProcessIdentity): boolean {
  if (peer.pid !== host.pid || !peer.alive()) return false;
  const observed = processIdentity(peer.pid);
  return observed !== null && observed.startTime === host.startTime;
}

/** Serves one connection whose first frames decide what it is. Shared by both
 * endpoints so the peer binding and failure handling are written once. */
function serveConnection(
  ports: ConnectionPorts, socket: Duplex, open: () => boolean,
  admit: (peer: BoundPeer) => { handle: (raw: Record<string, unknown>, stream: AsyncIterable<Uint8Array> | null) => Promise<object>;
    preflight: (raw: Record<string, unknown>) => void },
): void {
  let peer: BoundPeer | null = null;
  let transferred = false;
  try {
    if (ports.isDraining() || !open()) throw new StoreError("BROKER_UNAVAILABLE", "broker is draining", { details: { reason: "draining" } });
    peer = ports.bindPeer(socket);
    if (!peer || peer.uid !== (process.getuid?.() ?? -1))
      throw new StoreError("AUTH_FAILED", "invalid principal peer credentials");
    const served = admit(peer);
    ports.serveFrames(socket, peer, served.handle, served.preflight);
    transferred = true;
  } catch (error) {
    ports.observe(error);
    ports.fail(socket, publicFailure(error));
  } finally {
    if (!transferred) {
      try { peer?.releaseConnection(); } catch (error) { ports.cleanupError(error); }
    }
  }
}

export class PrincipalEndpoint {
  private session: RegisteredSession | null = null;
  private open = true;
  /** Registrations made so far. Never reused, so a connection cannot be bound
   * to a session that has since been replaced by an identical-looking one. */
  private registrations = 0;
  /** Connections that have attached. Held so that a session which stops being
   * the Principal's takes its connections with it instead of leaving them
   * open and authorised. */
  private readonly attached = new Set<Duplex>();

  constructor(private readonly channel: PrincipalHostChannel, private readonly ports: PrincipalEndpointPorts) {
    if (!Number.isSafeInteger(channel.host.pid) || channel.host.pid <= 1)
      throw new StoreError("UNSUPPORTED_PROFILE", "the principal host channel has no host process");
    channel.onSession((sessionHandle, pid) => {
      // A refused registration is answered, never left for the host to time
      // out on; the previous session, if any, is gone either way.
      try { this.register(sessionHandle, pid); }
      catch (error) {
        this.retire();
        ports.observe(error);
        // The refusal names the registration it answers. A handle that is not
        // a handle cannot be named back -- the real channel's grammar cannot
        // carry one this far, so only a caller standing in for the channel
        // reaches here -- and it is observed rather than answered.
        try { channel.refuse(sessionHandle); } catch (unnameable) { ports.observe(unnameable); }
      }
    });
  }

  /** Ends the current session, if any, and with it every connection attached
   * under it. Authority is the binding to a registration, so this is the one
   * place authority is taken away, and it is taken away from connections that
   * are already open -- not only from ones that have yet to attach. */
  private retire(): void {
    this.session = null;
    const open = [...this.attached];
    this.attached.clear();
    for (const socket of open) {
      try { socket.destroy(); } catch (error) { this.ports.cleanupError(error); }
    }
  }

  /** A session the host registered. The engine must be the host's own child:
   * the host cannot make an arbitrary process the Principal by naming it. A
   * new registration replaces the old one and mints a new credential, so an
   * engine the host restarted is not left holding a credential that still
   * works for the process it replaced -- and the connections the replaced
   * session had open stop being the Principal's at the same instant, whether
   * or not they ever ask again. */
  register(sessionHandle: string, pid: number): void {
    if (!this.open) return;
    // Before anything that can fail, so a refused registration does not leave
    // the previous Principal attached either.
    this.retire();
    if (!isPrincipalSessionHandle(sessionHandle))
      throw new StoreError("INVALID_REQUEST", "the registered principal session handle is malformed");
    if (parentOf(pid) !== this.channel.host.pid)
      throw new StoreError("AUTH_FAILED", "the registered engine is not a child of the host");
    const engine = processIdentity(pid);
    if (engine === null) throw new StoreError("AUTH_FAILED", "the registered engine is not observed running");
    const credential = randomBytes(PRINCIPAL_CREDENTIAL_HEX / 2).toString("hex");
    this.registrations += 1;
    this.session = Object.freeze({ sessionHandle, engine, credential, generation: this.registrations });
    this.channel.grant(credential, sessionHandle);
  }

  /** The engine of the current registration, or null when there is none. The
   * host delivery endpoint asks this before it prepares anything: being the
   * host is not being a Principal.
   *
   * "There is none" includes a registration whose engine has since died. The
   * record outlives the process -- nothing tells this broker that a pid it
   * accepted has stopped existing -- so the pid alone would answer "yes" for
   * an engine that is gone, and the host would go on preparing mail for it and
   * recording boundaries against it. Identity is re-derived here for the same
   * reason it is re-derived on every model-facing request (AUTH-003), and a
   * registration found dead is retired rather than merely refused, so the
   * connections attached under it lose authority at the same instant. Found
   * dead means /proc said so (`processEnded`); an engine that could not be
   * observed is refused for now and retired for nothing (INV02). */
  get registeredEngine(): number | null {
    const session = this.session;
    if (session === null) return null;
    return this.engineRuns(session) ? session.engine.pid : null;
  }

  /** Whether the session's engine is observed running. One /proc says has
   * ended retires the session; one that could not be observed is not answered
   * for and retires nothing (INV02). The one owner of "has the Principal's
   * engine ended", for every path that asks. */
  private engineRuns(session: RegisteredSession): boolean {
    const engine = processEnded(session.engine);
    if (engine === "ended") setImmediate(() => { if (this.session === session) this.retire(); });
    return engine === "running";
  }

  /** The credential stops existing with the broker that minted it. */
  close(): void { this.open = false; this.retire(); }

  serve(socket: Duplex): void {
    serveConnection(this.ports, socket, () => this.open, peer => {
      // What this connection attached to, not what it was granted. An
      // AuthContext handed over at attach says what the caller could do then;
      // it cannot say whether the caller is still the Principal, so it is not
      // what authorises a request. The registration is re-checked on every
      // request and every preflight instead, which is also what lets the
      // `principal` row be edited mid-connection and take effect at once.
      let attachedTo: number | null = null;
      const authority = (): AuthContext => {
        const session = this.session;
        if (attachedTo === null || !this.open || session === null || session.generation !== attachedTo)
          throw new StoreError("AUTH_FAILED", "the principal session this connection attached to is no longer registered");
        // Descent from the registered engine is not a fact about the past.
        // Checked once at attach, it answers "was this process started by the
        // engine", never "is the engine still the Principal's". An engine that
        // ends leaves its children running and reparented, so a connection
        // opened while it ran would go on acting for a Principal that stopped
        // existing -- the generation is untouched, because nothing
        // re-registered. It is re-derived from /proc here, on every request
        // and every preflight, exactly like the registration.
        if (!peer.alive() || !descendsFrom(peer.pid, session.engine)) {
          // The engine itself may be what is gone, in which case no connection
          // of this session is the Principal's any more. Authority is taken
          // from all of them at once rather than one refusal at a time, so a
          // connection that never asks again is not left attached. It is taken
          // after this refusal is written: the caller is told why it lost
          // authority instead of finding a closed socket.
          this.engineRuns(session);
          throw new StoreError("AUTH_FAILED", "the principal engine this connection was started by is no longer registered");
        }
        // P0V-60: the authority handed on keeps asking the same question --
        // this registration, this engine's descendant -- at every later read.
        const live = (): boolean => this.open && this.session === session && session.generation === attachedTo &&
          peer.alive() && descendsFrom(peer.pid, session.engine);
        const auth = this.ports.principalContext(peer, live);
        if (auth === null) throw new StoreError("AUTH_FAILED", "no live principal to act for");
        return auth;
      };
      return {
        handle: async (raw, stream) => {
          if (attachedTo === null) {
            const attached = this.attach(raw, peer);
            attachedTo = attached.generation;
            this.attached.add(socket);
            socket.once("close", () => { this.attached.delete(socket); });
            return attached.answer;
          }
          if (raw.method === "principal.detach") {
            // P0V-32: the envelope is read the way every internal one is.
            const problem = internalEnvelopeProblem(raw);
            if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
            attachedTo = null;
            this.attached.delete(socket);
            // The declared answer (response-codec), not a shape of its own.
            return okAnswer(raw.id as string, { detached: true });
          }
          return this.ports.dispatch(authority(), raw as Request, stream);
        },
        preflight: raw => {
          if (attachedTo === null) throw new StoreError("AUTH_FAILED", "the principal session is not attached");
          this.ports.preflight(authority(), raw);
        },
      };
    });
  }

  /** The attach frame. Its shape and parameters come from the protocol
   * registry, so this cannot drift from the declared contract. */
  private attach(raw: Record<string, unknown>, peer: BoundPeer): { generation: number; answer: object } {
    const id = typeof raw.id === "string" ? raw.id : "x";
    // P0V-32, P0-2: the envelope first, as on every internal channel; a
    // malformed frame is a malformed frame whatever it names.
    const problem = internalEnvelopeProblem(raw);
    if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
    if (raw.method !== "principal.attach")
      throw new StoreError("AUTH_FAILED", "the principal session must attach before any other request");
    if (INTERNAL_METHODS["principal.attach"].paramsCheck(raw.params) !== null)
      throw new StoreError("INVALID_REQUEST", "invalid principal attach parameters");
    const params = raw.params as { sessionHandle: string; credential: string };
    const session = this.session;
    if (!this.open || session === null)
      throw new StoreError("AUTH_FAILED", "no principal session is registered");
    if (!credentialMatches(params.credential, session.credential))
      throw new StoreError("AUTH_FAILED", "principal attach credential is not this broker's");
    // The society has one Principal, and which one was decided by the host. A
    // caller naming another session is a conflict, not a failed
    // authentication: the two recover differently.
    if (!sessionHandleMatches(params.sessionHandle, session.sessionHandle))
      throw new StoreError("ATTACH_CONFLICT", "another principal session owns this society");
    // The credential is necessary, not sufficient: the connecting process must
    // have been started by the registered engine.
    if (!descendsFrom(peer.pid, session.engine) || !peer.alive())
      throw new StoreError("AUTH_FAILED", "the connecting process was not started by the principal engine");
    const auth = this.ports.principalContext(peer, () => this.session === session && peer.alive());
    if (!auth) throw new StoreError("AUTH_FAILED", "no live principal to attach to");
    return { generation: session.generation, answer: okAnswer(id, { actor: "principal", incarnation: auth.incarnation }) };
  }
}

/** PR-002: the host's endpoint for delivering mail to the Principal. It serves
 * exactly the runner's two delivery methods, with their registered shapes, for
 * the Principal actor, to exactly one process: the host at the other end of
 * the supervision channel. */
export class PrincipalHostEndpoint {
  private open = true;

  constructor(private readonly channel: PrincipalHostChannel, private readonly ports: PrincipalHostEndpointPorts) {}

  close(): void { this.open = false; }

  serve(socket: Duplex): void {
    // The refusal of a non-host is the answer to its request, not a reply sent
    // before it asked: a caller must be able to tell "you are not the host"
    // from a broken connection.
    serveConnection(this.ports, socket, () => this.open, peer => ({
      handle: async raw => this.dispatch(raw, peer),
      preflight: () => { throw new StoreError("INVALID_REQUEST", "principal delivery accepts no raw stream bodies"); },
    }));
  }

  private async dispatch(raw: Record<string, unknown>, peer: BoundPeer): Promise<object> {
    const id = typeof raw.id === "string" ? raw.id : "x";
    if (!isHost(peer, this.channel.host))
      throw new StoreError("AUTH_FAILED", "only the host that started this broker may deliver to the principal");
    // P0V-32: the host is known; its frame is read as every internal one is.
    const problem = internalEnvelopeProblem(raw);
    if (problem !== null) throw new StoreError("INVALID_REQUEST", problem);
    const method = raw.method;
    // The host is already known by this point, so a method this endpoint does
    // not serve is a method-surface answer, not an authentication one
    // (IPC-012). The two are not interchangeable here: error class decides
    // what a caller may retry. It is also settled before anything about the
    // Principal, because whether a method exists does not depend on whether a
    // session is registered.
    if (method !== "batch.prepare" && method !== "batch.complete")
      throw new StoreError("UNKNOWN_METHOD", `method ${String(method)} is not served on the principal host endpoint`);
    // Being the host is not being a Principal. Delivery puts the society's mail
    // into an engine and records a boundary against it, and only a registration
    // this broker made says which engine that is and that this broker accepted
    // it. Without one there is nothing to deliver to, however sure the host is
    // that it has an engine: a refused or not-yet-answered registration used to
    // be indistinguishable here from an accepted one.
    if (this.ports.registeredEngine() === null)
      throw new StoreError("AUTH_FAILED", "no principal session is registered with this broker");
    const auth = this.ports.principalContext(peer, () => this.ports.registeredEngine() !== null);
    if (!auth) throw new StoreError("AUTH_FAILED", "no live principal to deliver to");
    if (method === "batch.prepare") {
      if (INTERNAL_METHODS["batch.prepare"].paramsCheck(raw.params) !== null)
        throw new StoreError("INVALID_REQUEST", "invalid batch.prepare parameters");
      return okAnswer(id, await this.ports.prepare(auth));
    }
    if (INTERNAL_METHODS["batch.complete"].paramsCheck(raw.params) !== null)
      throw new StoreError("INVALID_REQUEST", "invalid batch.complete parameters");
    await this.ports.complete(auth, raw.params as BoundaryEvidence);
    return okAnswer(id, { completed: true });
  }
}
